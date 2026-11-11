import { useWhatIsThis } from '../help/WhatIsThis';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent, ReactNode } from 'react';
import { create } from 'zustand';
import { formatDuration } from '../../../shared/format';
import { actionFor, LIBRARY_KEYMAP } from '../../../shared/keymap';
import type { RenderSlide } from '../../../shared/model';
import type { ItemOrder, PlaylistItemInfo, TimerCue } from '../../../shared/playlists';
import type { PresentationDoc } from '../../../shared/library';
import { repeatPresentationId } from '../../../shared/repeat';
import { itemPlayOrder } from '../../../shared/order';
import { slotCategoryName, SMART_MAX_FILES } from '../../../shared/playlists';
import { folderEnd, hasFolder, playlistFolders } from '../../../shared/playlist-folders';
import { useEngine } from '../engine/engine-store';
import { useLibrary } from '../library/library-store';
import { CannotPlayBadge, mediaKindIcon, mediaProblem } from '../library/MediaList';
import { useExtras } from '../library/extras-store';
import { useLandedInView } from '../links/link-playlist';
import { chooseAddTo, openLinkDialog } from '../links/link-store';
import { MediaStill } from '../render/MediaStill';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { Badge, LiveBadge, MissingBadge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { rowTops, slideRows, useLivelyArrival } from '../ui/motion';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  BookTemplate,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  FilePlus,
  Folder,
  FolderSync,
  Link2,
  Play,
  Repeat2,
  RotateCcw,
  ListMusic,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Presentation,
  SquareDashed,
  Timer,
  Trash2,
  Video,
  X,
} from '../ui/icons';
import { MenuButton } from '../ui/Menu';
import { Field, Select } from '../ui/Field';
import { fileMenuProps } from '../files/FileMenu';
import { playlistRow, slideOutEntry, slideRowTarget } from '../files/targets';
import { setJumpRows } from '../operator/jump';
import { practisePlaylist } from '../practice/practice-store';
import { useDocs, readDocAgain, useWantDocs } from './docs-store';
import { useFolded } from './fold-store';
import { groupDocId, groupName, type MiddleRow, playlistRows, repeatRows } from './rows';
import { SlideRow } from './SlideRow';
import { slideRowAt, type SlideRowAt } from './slide-order';
import { Notice } from '../ui/Notice';
import { rowClass } from '../ui/ListRow';
import { RowDelete } from '../ui/RowDelete';
import { EmptyState } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { plural } from '../ui/text';
import { BoxOverlay, boxChoice, ChosenBar, isSelectAll, rowsTouching, useBoxSelect } from '../ui/select-many';
import {
  afterDrag,
  draggedSlide,
  dragKind,
  droppedIds,
  droppedPaths,
  hasFiles,
  startDrag,
  useDragging,
} from './drag';
import { droppedItems, isRemoveKey, RenameField } from './playlist-shared';
import { useSmart } from './smart-store';
import { openSlideEditor } from '../editor/open-editor';
import { RepeatBar } from './RepeatBar';
import { useLastSecondsRow } from '../wallpapers/when-ends';
import { FolderCrumbs } from './PlaylistFolders';
import { PlaylistsUnread } from './PlaylistsUnread';
import { type CardClick, clickCard, clickSlideRow, meantPress } from './one-click';
import {
  addFromLibrary,
  addHeader,
  chooseItemOrder,
  clickItem,
  closePlaylist,
  duplicatePlaylist,
  fillPlaceholder,
  dropFolders,
  importIntoPlaylist,
  itemName,
  markedItems,
  moveItemBy,
  moveItems,
  moveSlide,
  moveSlideBy,
  newFromTemplate,
  removeMissingItems,
  renameHeader,
  renameNode,
  requestRemoveMarkedItems,
  requestRemoveNode,
  showsFolders,
  slideOut,
  slideOutBelow,
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
 *
 * Session 55 (Part 4): the playlist is where things go live, and has the whole middle (the slides area under it went).
 * A presentation's, a PDF's or a deck's slides are rows under its name, "<name>_1" to "<name>_N", which its name
 * folds; one click on any row puts it up (playlists/one-click.ts), and every row that goes up has a number for
 * jumping to it from the keyboard (operator/jump.ts). Each row has the one right-click menu (Part 14,
 * files/FileMenu.tsx); its Delete takes it out of this playlist only, asking first when it is up. Part 4b: a slide's
 * row dragged within its deck changes this playlist's own order of its slides; dragged anywhere else in the playlist,
 * it becomes an item of its own there (playlists/slide-order.ts), each with one Undo. From the keyboard: Alt+↑ ↓ on the
 * row moves it a place within its deck (at its first or last row it stays put), and its menu's Make it an item of its
 * own (Shift+F10) puts it straight after its deck; the keyboard goes with the row.
 */

// ---- the open playlist's items ----------------------------------------------------------

/**
 * Where a drag would land: before the item at `at` (or at the end), or on a placeholder to fill it. Shown a
 * folder at a time (Session 44), the end is the folder's; one with no part of its own gets a header first.
 */
type DropSpot = { at: number; header?: string } | { fill: string };

/** Where a slide's row dragged within its own deck would land (Session 55, Part 4b): before its row at `before`. */
interface SlideSpot {
  itemId: string;
  before: number;
}
const sameSlideSpot = (a: SlideSpot | null, b: SlideSpot | null) =>
  a === b || (a !== null && b !== null && a.itemId === b.itemId && a.before === b.before);

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
      return 'Passage from a book';
    case 'placeholder':
      return item.hint === null ? 'Slot' : 'Not found';
    case 'input':
      return 'Video input';
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

/**
 * The picture on an item's card: a presentation's first slide (with this playlist's own order of its slides, Part 4b,
 * the first of those, once they are read), a picture or a video's still, or an icon.
 */
function ItemPicture({ item }: { item: PlaylistItemInfo }) {
  const first = useCardSlides((s) =>
    item.kind === 'presentation' ? s.slides[item.presentationId] : undefined,
  );
  const ownOrder = item.kind === 'presentation' && item.order.mode === 'slides' ? item.order : null;
  const doc = useDocs((s) =>
    ownOrder && item.kind === 'presentation' ? s.docs[item.presentationId] : undefined,
  );
  const ownFirst = ownOrder && doc ? itemPlayOrder(doc, ownOrder, item.id).slides[0]?.slide.slide : undefined;
  const slide = ownFirst ?? first;
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
        : item.kind === 'input'
          ? Video
          : item.kind === 'placeholder'
            ? item.hint === null
              ? SquareDashed
              : AlertTriangle
            : Presentation;
  const warn = (item.kind === 'placeholder' && item.hint !== null) || (item.kind === 'input' && item.missing);
  return (
    <span aria-hidden="true" className={cx(PICTURE_BOX, 'flex items-center justify-center bg-panel-3')}>
      <KindIcon size={18} className={warn ? 'text-warning' : 'text-muted'} />
    </span>
  );
}

/** A row's number, for jumping to it (Session 55): blank where the row never goes up. */
function RowNumber({ number }: { number: number | null }) {
  return (
    <span
      className="w-6 shrink-0 text-right text-xs text-muted tabular-nums"
      data-testid={number === null ? undefined : 'row-number'}
      aria-hidden="true"
    >
      {number ?? ''}
    </span>
  );
}

/** An item's card: its picture, its name, what it is and its length or slide count (Session 26a). */
function ItemBody({
  item,
  live,
  number = null,
  fold = null,
}: {
  item: PlaylistItemInfo;
  live: boolean;
  /** Its number for jumping to it (a picture's, a video's, a sound's, a video input's). */
  number?: number | null;
  /** A presentation's name row (Session 55): whether its slides are folded under it. */
  fold?: boolean | null;
}) {
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
  const Chevron = fold ? ChevronRight : ChevronDown;
  return (
    <span className="flex items-center gap-2.5">
      {fold === null ? (
        <RowNumber number={number} />
      ) : (
        <span className="flex w-6 shrink-0 justify-end text-muted" data-testid="fold-mark" aria-hidden="true">
          <Chevron size={16} />
        </span>
      )}
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
          {/* Added from a phone (Session 54): the device's name. */}
          {(item.kind === 'media' || item.kind === 'presentation') && item.fromDevice !== undefined
            ? ` · from ${item.fromDevice}`
            : ''}
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
          ) : item.order.mode === 'slides' ? (
            // Its slides' rows dragged (Session 55, Part 4b): this playlist's order, never the library's.
            <span className="block truncate text-xs text-muted" data-testid="item-own-order">
              In this playlist’s own order
            </span>
          ) : null)}
        {item.kind === 'shastra' && item.missing && (
          <span className="text-xs text-warning-fg">Its book is not loaded</span>
        )}
        {/* A video input this computer has none of (Session 51): said plainly, and Next goes past it. */}
        {item.kind === 'input' && item.missing && (
          <span
            className="block truncate text-xs text-warning-fg"
            data-testid="item-input-missing"
            title={`No video input called “${item.name}” is on this computer, so Next goes past it. Add a Video Input… in Media can name one so.`}
          >
            Not on this computer
          </span>
        )}
        {item.kind === 'placeholder' && (
          <span
            className={cx('block truncate text-xs', item.hint === null ? 'text-muted' : 'text-warning-fg')}
          >
            {item.hint === null
              ? `A slot${item.category ? ` · ${slotCategoryName(item.category)}` : ''} · choose what goes here`
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
      {/* Session 50: “Converting…” while Drashti converts it; it cannot go live until then either way. */}
      {item.kind === 'media' &&
        (item.missing ? <MissingBadge /> : problem && <CannotPlayBadge mediaId={item.mediaId} />)}
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
 * for the items whose files are gone (Pro Mode's: `simple` leaves it out).
 */
function SmartBar({ playlistId, simple }: { playlistId: string; simple: boolean }) {
  const view = useSmart((s) => s.views[playlistId]);
  if (!view) return null;
  return (
    <div
      data-testid="smart-bar"
      data-state={view.state}
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-1.5 text-xs"
    >
      {/* What it is, in a line (Session 56, the owner's item 4: "a smart playlist follows a folder on the computer"). */}
      <span className="text-muted">A smart playlist, following</span>
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
      {view.missing > 0 && !simple && (
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

/** An item's slide rows, as the middle shows them. */
const slideRowsOf = (itemId: string) =>
  document.querySelector(`[data-item-row="${CSS.escape(itemId)}"] [data-testid="slide-rows"]`);

/**
 * After a slide's row moved from the keyboard (Part 4b): the keyboard on that row where it is now, in `itemId`'s slides
 * (its deck's, or the item it was made into), found by what it plays. Only while the keyboard is where `still` says it
 * was left, or lost as the list was drawn again: never taken from where the operator has gone since. The row it is on.
 */
function keepSlideFocus(
  itemId: string,
  row: SlideRowAt,
  still: (now: Element) => boolean,
): HTMLElement | null {
  const now = document.activeElement;
  if (now !== null && now !== document.body && !still(now)) return null;
  const there =
    slideRowsOf(itemId)?.querySelectorAll<HTMLElement>(
      `[data-testid="slide-thumb"][data-slide-id="${CSS.escape(row.slideId)}"]`,
    )[row.time] ?? null;
  if (there && there !== now) there.focus();
  return there;
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
  before = null,
}: {
  name: string;
  first: boolean;
  last: boolean;
  /** While a drag is under way: hidden, keeping its room (drag.ts). */
  hidden: boolean;
  onMove: (step: -1 | 1, on: 'up' | 'down') => void;
  /** Before Up and Down on their line: a presentation's order (Session 55). */
  before?: ReactNode;
}) {
  // When these appeared: a click on them straight after is a double click's second, on the card they came
  // under (Session 54's review), and moves nothing.
  const shownAt = useRef(0);
  useLayoutEffect(() => {
    shownAt.current = performance.now();
  }, []);
  const press = (e: MouseEvent, step: -1 | 1, on: 'up' | 'down') => {
    if (meantPress(e.detail, shownAt.current, performance.now())) onMove(step, on);
  };
  return (
    <span
      role="group"
      aria-label={`Move “${name}”`}
      data-testid="playlist-item-moves"
      className={cx('mt-1 mb-1 flex flex-wrap items-center justify-end gap-1', hidden && 'invisible')}
    >
      {before}
      <Button
        size="sm"
        icon={ArrowUp}
        data-move="up"
        disabled={first}
        title="Up a place (Alt+↑)"
        onClick={(e) => {
          press(e, -1, 'up');
        }}
      >
        Up
      </Button>
      <Button
        size="sm"
        icon={ArrowDown}
        data-move="down"
        disabled={last}
        title="Down a place (Alt+↓)"
        onClick={(e) => {
          press(e, 1, 'down');
        }}
      >
        Down
      </Button>
    </span>
  );
}

const orderValue = (order: ItemOrder) =>
  order.mode === 'arrangement' ? `a:${order.arrangementId}` : order.mode;

/**
 * The order a presentation's row plays it in (its arrangements: the slide grid's picker until Session 55), on the line
 * with Up and Down under the chosen row: the presentation's own, every slide, or one of its arrangements. This
 * playlist only. Part 4b: with this playlist's own order of its slides (its rows dragged), that too, chosen; another
 * choice sets it aside, with Undo.
 */
function OrderPicker({
  item,
  doc,
}: {
  item: Extract<PlaylistItemInfo, { kind: 'presentation' }>;
  doc: PresentationDoc;
}) {
  const ownSlides = item.order.mode === 'slides';
  if (doc.arrangements.length === 0 && !ownSlides) return null;
  const own = doc.arrangements.find((a) => a.id === doc.selectedArrangementId)?.name ?? 'all slides in order';
  return (
    <Field label="Order" layout="inline" className="mr-auto">
      <Select
        data-testid="arrangement"
        className="max-w-52"
        value={orderValue(item.order)}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'slides') return;
          void chooseItemOrder(
            item,
            v === 'presentation' || v === 'all'
              ? { mode: v }
              : { mode: 'arrangement', arrangementId: v.slice(2) },
          );
        }}
      >
        <option value="presentation">As the presentation plays ({own})</option>
        <option value="all">All slides in order</option>
        {doc.arrangements.map((a) => (
          <option key={a.id} value={`a:${a.id}`}>
            {a.name}
          </option>
        ))}
        {ownSlides && <option value="slides">This playlist’s own order</option>}
      </Select>
    </Field>
  );
}

/** A click from the keyboard (a jump to a row's number, Session 55): as Enter on it. */
const KEY_CLICK: CardClick = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, detail: 0 };

/** Under a presentation's name: why its slides are not there (still being read, unread, gone). */
function GroupNote({ row }: { row: Extract<MiddleRow, { kind: 'group' }> }) {
  if (row.read === 'ready' || row.folded) return null;
  if (row.read === 'loading') return <p className="py-1 pl-10 text-xs text-muted">Reading its slides…</p>;
  if (row.read === 'unread')
    return (
      <p className="flex items-center gap-2 py-1 pl-10 text-xs text-warning-fg" data-testid="group-unread">
        Drashti couldn’t read its slides.
        <Button size="sm" icon={RotateCcw} onClick={() => void readDocAgain(groupDocId(row.item))}>
          Try again
        </Button>
      </p>
    );
  return null;
}

function PlaylistItems({ platform, openId, simple }: { platform: string; openId: string; simple: boolean }) {
  const node = usePlaylists(
    (s) => s.tree.find((n) => n.id === openId) ?? s.templates.find((n) => n.id === openId),
  );
  const isTemplate = usePlaylists(templateOpen);
  // Slots and templates only with View › Show Books, Templates and Kirtan Details (Session 26a).
  const extras = useExtras((s) => s.on);
  const items = usePlaylists((s) => s.items);
  const itemsUnread = usePlaylists((s) => s.unread.itemsOf === openId);
  const arriving = useLivelyArrival(openId);
  const listRef = useRef<HTMLUListElement>(null);
  /** Where the rows were before a move (Up, Down, Alt+↑ ↓), until the list is drawn in its new order. */
  const slideFrom = useRef<Map<string, number> | null>(null);
  /** Where the keyboard was before a move, put back in the same commit as the list's new order. */
  const focusFrom = useRef<{ id: string; on: 'item' | 'up' | 'down' } | null>(null);
  /**
   * A slide's row moved from the keyboard (Alt+↑ ↓, Part 4b), while its moves are under way: the keyboard goes with it
   * in the same commit as each new order, so a key pressed straight after lands on the row that moved.
   */
  const slideFocus = useRef<{ itemId: string; row: SlideRowAt; on: Element } | null>(null);
  /** How many of those moves are under way: the keyboard stops following once the last has landed. */
  const slideMoves = useRef(0);
  useLayoutEffect(() => {
    const keep = focusFrom.current;
    focusFrom.current = null;
    if (keep) keepFocus(keep.id, keep.on);
    const slide = slideFocus.current;
    if (slide) slide.on = keepSlideFocus(slide.itemId, slide.row, (now) => now === slide.on) ?? slide.on;
    const before = slideFrom.current;
    if (!before) return;
    slideFrom.current = null;
    slideRows(listRef.current, 'data-item-row', before);
  }, [items]);
  const marked = usePlaylists((s) => s.marked);
  const anchorId = usePlaylists((s) => s.anchorId);
  // Made from a folder (Session 44): the folder shown has its own items here, its folders in the bottom left (in Simple
  // Mode too since Session 56, which has Pro Mode's left column).
  const byFolder = usePlaylists(showsFolders);
  const folder = usePlaylists((s) => s.folder);
  const view = useMemo(() => playlistFolders(items), [items]);
  const shownFolder = byFolder && hasFolder(view, folder) ? folder : '';
  const rows = useMemo(
    () =>
      items.flatMap((item, index) =>
        !byFolder || (item.kind !== 'header' && view.folderOf.get(item.id) === shownFolder)
          ? [{ item, index }]
          : [],
      ),
    [items, byFolder, view, shownFolder],
  );
  // A download from a link, just in (Session 54): its card brought into view, never given the keyboard.
  useLandedInView(listRef, rows);
  const end: DropSpot = useMemo(() => {
    if (!byFolder) return { at: items.length };
    const at = folderEnd(items, view, shownFolder);
    return 'at' in at ? { at: at.at } : { at: at.headerAt, header: shownFolder };
  }, [items, byFolder, view, shownFolder]);
  const dragging = useDragging((s) => s.on);
  // Many chosen at once (Session 44): a box dragged from an empty place in the list, Cmd-A, Shift and Cmd.
  const boxBase = useRef<string[]>([]);
  const box = useBoxSelect({
    list: listRef,
    hits: (b) => (listRef.current ? rowsTouching(listRef.current, b) : []),
    begin: () => {
      boxBase.current = usePlaylists.getState().marked;
    },
    onBox: (ids, adding) => {
      const chosen = boxChoice(boxBase.current, ids, adding);
      usePlaylists.setState({ marked: chosen, anchorId: chosen[0] ?? null });
    },
    onClear: () => {
      usePlaylists.setState({ marked: [], anchorId: null });
    },
  });
  const renaming = usePlaylists((s) => s.renaming);
  const renameIn = usePlaylists((s) => s.renameIn);
  const [spot, setSpot] = useState<DropSpot | null>(null);
  const [slideSpot, setSlideSpot] = useState<SlideSpot | null>(null);
  // The cards' pictures: each presentation's first slide.
  const presentationIds = items.flatMap((i) => (i.kind === 'presentation' ? [i.presentationId] : []));
  const wanted = presentationIds.join(' ');
  useEffect(() => {
    wantSlides(wanted === '' ? [] : wanted.split(' '));
  }, [wanted]);
  // What is this? (Sessions 31–36): its ? in the playlist's header row, its words under it.
  const help = useWhatIsThis('playlist');
  const markedSet = new Set(marked);
  // The rows (Session 55): each presentation's slides under its name, read as the playlist shows them; a Repeat Slides
  // playlist's steps from its own slides.
  const isRepeat = node?.kind === 'repeat';
  const repeatId = repeatPresentationId(openId);
  const docs = useDocs((s) => s.docs);
  useWantDocs(
    isRepeat
      ? [repeatId]
      : items.flatMap((i) =>
          i.kind === 'presentation' && i.presentationName !== null
            ? [i.presentationId]
            : i.kind === 'shastra' && !i.missing
              ? [i.passageId]
              : [],
        ),
  );
  const foldedIds = useFolded((s) => s.folded);
  const middle = useMemo(() => {
    const folded = new Set(foldedIds);
    if (isRepeat) return repeatRows(items, docs[repeatId], folded);
    return playlistRows(items, new Map(Object.entries(docs)), folded);
  }, [items, docs, foldedIds, isRepeat, repeatId]);
  /** Each item's row (its number, or its name row) and its slides' rows. */
  const byItem = useMemo(() => {
    const out = new Map<
      string,
      {
        row: Extract<MiddleRow, { kind: 'item' | 'group' }> | null;
        slides: Extract<MiddleRow, { kind: 'slide' }>[];
      }
    >();
    for (const r of middle) {
      const id = r.item?.id;
      if (id === undefined) continue;
      const at = out.get(id) ?? { row: null, slides: [] };
      if (r.kind === 'slide') at.slides.push(r);
      else at.row = r;
      out.set(id, at);
    }
    return out;
  }, [middle]);
  // Jump by number (Session 55): every numbered row puts itself up as a click on it does.
  useEffect(() => {
    setJumpRows(
      middle.flatMap((r) =>
        r.kind === 'slide'
          ? [{ number: r.number, go: () => clickSlideRow(r, KEY_CLICK, platform) }]
          : r.kind === 'item' && r.number !== null
            ? [{ number: r.number, go: () => clickCard(r.item, KEY_CLICK, platform) }]
            : [],
      ),
    );
    return () => {
      setJumpRows([]);
    };
  }, [middle, platform]);
  // The slide on the screens, to mark its row LIVE: which presentation, which slide, from which item, in which order.
  const liveSlide = useEngine((s) => {
    const st = s.state;
    const shown = st?.layers.slide;
    if (!st || !shown || shown.timer) return null;
    return `${shown.presentationId}|${shown.slide.id}|${st.live.playlist?.itemId ?? ''}|${String(st.live.arrangementId)}|${String(st.live.slideIndex)}`;
  });
  const isSlideLive = useCallback(
    (r: Extract<MiddleRow, { kind: 'slide' }>): boolean => {
      if (liveSlide === null) return false;
      const [presentationId, slideId, itemId, arrangementId, slideIndex] = liveSlide.split('|');
      if (presentationId !== r.presentationId) return false;
      // A Repeat Slides playlist's step, by its slide.
      if (isRepeat) return slideId === r.at.slide.id;
      // Played from this row's item: by its place in the order it plays.
      if (itemId === r.item?.id)
        return arrangementId === String(r.arrangementId)
          ? slideIndex === String(r.at.position)
          : slideId === r.at.slide.id;
      // Played from the library (no item): by the slide itself.
      return itemId === '' && slideId === r.at.slide.id;
    },
    [liveSlide, isRepeat],
  );
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
  // A video's last 10 seconds (Session 55, Part 6, E): its row turns amber.
  const endingItem = useLastSecondsRow();

  const spotFor = (e: DragEvent): DropSpot => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-item-index]');
    if (!row) return end;
    const index = Number(row.dataset['itemIndex']);
    // On a presentation's name (Session 55: its slides are rows under it), its halves are the name's own; on its
    // slides, the whole row's.
    const name = (e.target as HTMLElement).closest<HTMLElement>('[data-testid="playlist-item"]');
    const box = (name && row.contains(name) ? name : row).getBoundingClientRect();
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
  /**
   * A slide's row over its own deck (Session 55, Part 4b): before which of its rows it lands (by their halves; past
   * the last, after it), or, on the lower half of the deck's name, first. Null anywhere else: dropped there, it becomes
   * an item of its own.
   */
  const slideSpotFor = (e: DragEvent): SlideSpot | null => {
    const dragged = draggedSlide();
    if (!dragged) return null;
    const target = e.target as HTMLElement;
    if (target.closest<HTMLElement>('[data-item-row]')?.dataset['itemRow'] !== dragged.itemId) return null;
    const list = target.closest<HTMLElement>('[data-testid="slide-rows"]');
    if (list) {
      const rowsHere = [...list.querySelectorAll<HTMLElement>('[data-testid="slide-thumb"]')];
      const at = rowsHere.findIndex((r) => {
        const b = r.getBoundingClientRect();
        return e.clientY < b.top + b.height / 2;
      });
      return { itemId: dragged.itemId, before: at < 0 ? rowsHere.length : at };
    }
    const name = target.closest<HTMLElement>('[data-testid="playlist-item"]');
    if (!name) return null;
    const box = name.getBoundingClientRect();
    return (e.clientY - box.top) / Math.max(1, box.height) >= 0.5
      ? { itemId: dragged.itemId, before: 0 }
      : null;
  };

  const onDragOver = (e: DragEvent) => {
    const kind = dragKind(e);
    if (!kind && !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = kind === 'items' || kind === 'slide' ? 'move' : 'copy';
    const within = kind === 'slide' ? slideSpotFor(e) : null;
    if (!sameSlideSpot(slideSpot, within)) setSlideSpot(within);
    if (within) {
      if (spot !== null) setSpot(null);
      return;
    }
    const next = spotFor(e);
    if (!sameSpot(spot, next)) setSpot(next);
  };
  const onDrop = (e: DragEvent) => {
    const kind = dragKind(e);
    // Files from the Finder or Explorer: imported as anywhere, then added where they landed, in the
    // order dropped (Session 26a). The window's own drop, which only imports, never sees them. A folder (Session 56,
    // item 5): a smart playlist following it, at once, opened here.
    if (!kind && hasFiles(e)) {
      e.preventDefault();
      e.stopPropagation();
      const where = spotFor(e);
      setSpot(null);
      const at = 'at' in where ? where.at : items.findIndex((i) => i.id === where.fill);
      const header = 'at' in where ? (where.header ?? null) : null;
      void dropFolders(droppedPaths(e), (files) => importIntoPlaylist(openId, at, files, header));
      return;
    }
    if (!kind) return;
    e.preventDefault();
    const where = spotFor(e);
    setSpot(null);
    // A slide's row (Session 55, Part 4b): within its deck, a new place there; elsewhere, an item of its own.
    if (kind === 'slide') {
      const within = slideSpotFor(e);
      setSlideSpot(null);
      const [itemId, position] = droppedIds(e, 'slide');
      if (itemId === undefined || position === undefined) return;
      if (within) void moveSlide(itemId, Number(position), within.before);
      else if ('at' in where) void slideOut(itemId, Number(position), where.at);
      return;
    }
    if (kind === 'items') {
      if ('at' in where) void moveItems(droppedIds(e, 'items'), where.at);
      return;
    }
    if ('fill' in where)
      void fillPlaceholder(where.fill, droppedIds(e, kind === 'passages' ? 'passages' : 'presentations'));
    else
      void addFromLibrary(
        openId,
        where.at,
        where.header === undefined
          ? droppedItems(e)
          : [{ kind: 'header', label: where.header }, ...droppedItems(e)],
      );
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
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setSpot(null);
        setSlideSpot(null);
      }}
      onDrop={onDrop}
    >
      <div
        className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-2"
        data-strip=""
      >
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
            // Simple Mode renames playlists too since Session 56 (its left column has them).
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
        {/* Simple Mode (Session 55, Part 18): no menu of the playlist's own (its Rename and Delete are on the left since
            Session 56, beside the other playlists), and no Close. */}
        {!simple && (
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
              // Session 55, Part 4: Practise it in this window only, and Duplicate it (the owner's ideas T and P).
              ...(isTemplate
                ? []
                : [
                    {
                      label: 'Practise this playlist',
                      icon: Play,
                      separatorBefore: true,
                      onSelect: () => void practisePlaylist(openId),
                    },
                    {
                      label: 'Duplicate',
                      icon: CopyPlus,
                      onSelect: () => void duplicatePlaylist(openId),
                    },
                  ]),
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
        )}
        {!simple && (
          <IconButton
            icon={X}
            label="Close the playlist"
            size="sm"
            data-testid="playlist-close"
            onClick={closePlaylist}
          />
        )}
      </div>
      {byFolder && <FolderCrumbs path={shownFolder} top={node?.name ?? ''} />}
      {/* Its words shrink and scroll in the playlist's share of the middle (Session 51: in a 1024 × 645 window its
          buttons had run under the slides' strip below). */}
      {help.card && <div className="min-h-0 overflow-y-auto pt-2">{help.card}</div>}
      {node?.kind === 'smart' && <SmartBar playlistId={openId} simple={simple} />}
      {node?.kind === 'repeat' && node.repeat && (
        <RepeatBar playlistId={openId} settings={node.repeat} simple={simple} />
      )}
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
      {/* Simple Mode's Delete is in a row's right-click menu (and its Delete key): no bar of chosen items. */}
      {!simple && (
        <ChosenBar
          count={marked.length}
          noun="items"
          deleteLabel="Remove"
          onDelete={requestRemoveMarkedItems}
          onClear={() => {
            usePlaylists.setState({ marked: [], anchorId: null });
          }}
        />
      )}
      <ul
        ref={listRef}
        tabIndex={-1}
        onPointerDown={box.onPointerDown}
        onKeyDown={(e) => {
          // Cmd-A (Ctrl-A): every item shown; Delete on the list itself: the chosen ones (rows take their own).
          if (isSelectAll(e, platform)) {
            e.preventDefault();
            const ids = rows.map((r) => r.item.id);
            usePlaylists.setState({ marked: ids, anchorId: ids[0] ?? null });
          } else if (e.target === e.currentTarget && isRemoveKey(e, platform) && marked.length > 0) {
            e.preventDefault();
            requestRemoveMarkedItems();
          }
        }}
        aria-label={`Items in ${node?.name ?? 'the playlist'}${shownFolder === '' ? '' : `, ${shownFolder}`}`}
        data-testid="playlist-items"
        data-count={rows.length}
        data-folder={byFolder ? shownFolder : undefined}
        // (Drops are the section's: see above.)
        // Scrolled into view, an item keeps the list's padding: never flush against the divider below,
        // whose grab area reaches a few pixels into the list (a drop there would miss the list).
        className="relative min-h-0 flex-1 scroll-py-2 space-y-1 overflow-y-auto px-3 py-2 focus:outline-none"
      >
        <BoxOverlay box={box.box} as="li" />
        {rows.map(({ item, index }, row) => {
          const isMarked = markedSet.has(item.id);
          const isLive = liveItem === item.id;
          const line =
            lineAt === index
              ? 'shadow-[0_-2px_0_0_var(--color-accent)]'
              : lineAt === end.at && row === rows.length - 1
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
          // Its row in the middle's rows (Session 55): its number, or its name row and its slides.
          const own = byItem.get(item.id);
          const group = own?.row?.kind === 'group' ? own.row : null;
          const slides = own?.slides ?? [];
          const doc =
            item.kind === 'presentation' && !isRepeat ? (docs[item.presentationId] ?? undefined) : undefined;
          // One of its slides is up: its name row says LIVE too (folded, its slides are not there to say it).
          const slideUp = slides.some(isSlideLive);
          // A presentation's slide rows move (Part 4b), by a drag or from the keyboard: not a passage's, nor a Repeat
          // Slides playlist's steps.
          const canMoveSlides =
            !isRepeat && item.kind === 'presentation' && item.presentationName !== null && doc !== undefined;
          // Alt+↑ ↓ on a slide's row: a place within its deck, the keyboard going with the row in each new order.
          const moveSlideRow = (position: number, step: -1 | 1, pressed: Element) => {
            const at = item.kind === 'presentation' && doc ? slideRowAt(item, doc, position) : null;
            if (!at) return;
            slideFocus.current = { itemId: item.id, row: at, on: pressed };
            slideMoves.current += 1;
            void moveSlideBy(item.id, position, step).finally(() => {
              slideMoves.current -= 1;
              if (slideMoves.current === 0) slideFocus.current = null;
            });
          };
          // Make it an item of its own, from the row's menu: the keyboard goes with the row to the new item (the menu
          // gave it back to the row it was opened on, which now shows another slide, or is gone).
          const makeOwnItem = (position: number) => {
            const at = item.kind === 'presentation' && doc ? slideRowAt(item, doc, position) : null;
            if (!at) return;
            void slideOutBelow(item.id, position).then((made) => {
              if (made === null) return;
              requestAnimationFrame(() => {
                keepSlideFocus(made, { slideId: at.slideId, time: 0 }, (now) =>
                  Boolean(slideRowsOf(item.id)?.contains(now)),
                );
              });
            });
          };
          const menuProps = fileMenuProps(
            () => playlistRow(item, openId),
            () => {
              if (!usePlaylists.getState().marked.includes(item.id))
                clickItem(item.id, { toggle: false, range: false });
            },
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
              data-select-id={item.id}
              // Lively (Session 40): the cards of a playlist just opened arrive one after another (app.css).
              data-lively={arriving ? 'arrive' : undefined}
              style={arriving ? ({ '--i': index } as CSSProperties) : undefined}
              className={cx('group relative rounded-md', line)}
              onKeyDown={(e) => {
                // A key a slide's row has used itself (Part 4b: Alt+↑ ↓ moves the row within its deck) moves no item.
                if (e.defaultPrevented) return;
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
                // One click puts it up (Session 55): a show control, which never fades.
                data-show-control
                data-kind={item.kind}
                data-item-id={item.id}
                data-marked={isMarked ? 'true' : undefined}
                data-live={isLive ? 'true' : undefined}
                data-last-seconds={endingItem === item.id ? 'true' : undefined}
                data-row-number={own?.row?.kind === 'item' ? (own.row.number ?? undefined) : undefined}
                aria-pressed={isMarked}
                aria-expanded={group ? !group.folded : undefined}
                aria-current={shownItem === item.id ? 'true' : undefined}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                aria-label={
                  item.kind !== 'placeholder'
                    ? undefined
                    : item.hint === null
                      ? `Slot: ${item.label}${item.category ? ` (${slotCategoryName(item.category)})` : ''}. Press to choose what goes here.`
                      : `Not found: ${item.label}. Drag a presentation here to replace it.`
                }
                onClick={(e) => {
                  // One click puts any row up (Session 55: a picture, a video, a sound, a video input), Enter
                  // too; a presentation's name folds its slides; with Cmd/Ctrl or Shift it only marks.
                  clickCard(item, e, platform);
                }}
                onDoubleClick={() => {
                  // Simple Mode renames no header (it names a part of the playlist, not a file).
                  if (item.kind === 'header' && !simple) startRenaming(item.id);
                }}
                {...menuProps}
                onKeyDown={(e) => {
                  menuProps.onKeyDown(e);
                  if (e.defaultPrevented || !isRemoveKey(e, platform)) return;
                  e.preventDefault();
                  if (!usePlaylists.getState().marked.includes(item.id))
                    clickItem(item.id, { toggle: false, range: false });
                  requestRemoveMarkedItems();
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
                  endingItem === item.id && 'border-warning! bg-warning-bg!',
                )}
              >
                <ItemBody
                  item={item}
                  live={isLive || slideUp}
                  number={own?.row?.kind === 'item' ? own.row.number : null}
                  fold={group ? group.folded : null}
                />
              </button>

              {/* Simple Mode moves rows by dragging (and Alt+↑ ↓): no Up, Down or order under the chosen one. */}
              {isMarked && anchorId === item.id && !simple && (
                <MoveButtons
                  name={itemName(item)}
                  first={row === 0}
                  last={row === rows.length - 1}
                  hidden={dragging}
                  onMove={move}
                  before={item.kind === 'presentation' && doc ? <OrderPicker item={item} doc={doc} /> : null}
                />
              )}
              {/* Out of the playlist only (the library keeps it), as Delete does on the item; Undo puts it
                  back (Session 26a); asked first when it is up (Session 55). Last in the Tab order, after Up and
                  Down. */}
              {/* Simple Mode's Delete is the right-click menu's (Session 55, Part 18): no trash button. */}
              {!simple && (
                <RowDelete
                  label={`Remove “${itemName(item)}” from the playlist`}
                  chosen={isMarked && anchorId === item.id}
                  className={cx('absolute right-1.5', item.kind === 'header' ? 'top-0.5' : 'top-2')}
                  onDelete={() => {
                    if (!usePlaylists.getState().marked.includes(item.id))
                      clickItem(item.id, { toggle: false, range: false });
                    requestRemoveMarkedItems();
                  }}
                />
              )}
              {/* Its slides, a row each, under its name (Session 55); folded, none shows (each keeps its number). */}
              {group && <GroupNote row={group} />}
              {group && !group.folded && slides.length > 0 && (
                <ul
                  className="space-y-0.5 pt-0.5 pb-1 pl-4"
                  data-testid="slide-rows"
                  aria-label={`Slides of ${itemName(item)}`}
                >
                  {slides.map((r) => {
                    const menu = fileMenuProps(
                      () =>
                        slideRowTarget(
                          r,
                          groupName(group.item, doc ?? null),
                          isRepeat ? null : openId,
                          // Part 4b's keyboard move: what its drag out of the deck does (one of more than one slide).
                          canMoveSlides && slides.length > 1
                            ? [
                                slideOutEntry(() => {
                                  makeOwnItem(r.at.position);
                                }),
                              ]
                            : [],
                        ),
                      () => {
                        if (!usePlaylists.getState().marked.includes(item.id))
                          clickItem(item.id, { toggle: false, range: false });
                      },
                    );
                    return (
                      <SlideRow
                        // Dragged within its deck, or out of it (Session 55, Part 4b): a presentation's, not a
                        // passage's or a Repeat Slides playlist's step.
                        onDragStart={
                          canMoveSlides
                            ? (e) => {
                                startDrag(e, 'slide', [item.id, String(r.at.position)]);
                              }
                            : undefined
                        }
                        dropLine={
                          slideSpot?.itemId !== item.id
                            ? null
                            : slideSpot.before === r.at.position
                              ? 'before'
                              : slideSpot.before === slides.length && r.at.position === slides.length - 1
                                ? 'after'
                                : null
                        }
                        key={r.key}
                        number={r.number}
                        label={r.label}
                        line={r.line}
                        at={r.at}
                        firstOfRun={r.firstOfRun}
                        live={isSlideLive(r)}
                        itemId={item.id}
                        onClick={(e) => {
                          clickSlideRow(r, e, platform);
                        }}
                        onDoubleClick={
                          // Edit slides is Pro Mode's (Simple Mode has none).
                          !simple &&
                          r.item &&
                          !isRepeat &&
                          item.kind === 'presentation' &&
                          item.presentationName !== null
                            ? () =>
                                void openSlideEditor(
                                  r.presentationId,
                                  groupName(item, doc ?? null),
                                  r.at.slide.id,
                                )
                            : undefined
                        }
                        {...menu}
                        keyShortcuts={canMoveSlides ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                        onKeyDown={(e) => {
                          menu.onKeyDown(e);
                          if (e.defaultPrevented || !canMoveSlides) return;
                          const action = actionFor(e.nativeEvent, platform, LIBRARY_KEYMAP);
                          if (action !== 'moveItemUp' && action !== 'moveItemDown') return;
                          // Within its deck only: at its first or last row it stays put, and no item moves.
                          e.preventDefault();
                          moveSlideRow(r.at.position, action === 'moveItemUp' ? -1 : 1, e.currentTarget);
                        }}
                      />
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
        {/* A read that failed is said, with Try again (Session 39): never "empty" when it may not be. */}
        {items.length === 0 && itemsUnread && (
          <li>
            <PlaylistsUnread what="items" />
          </li>
        )}
        {/* A folder that holds only folders (Session 44): they are in the bottom left. */}
        {rows.length === 0 && items.length > 0 && byFolder && (
          <li data-testid="folder-only-folders">
            <EmptyState icon={Folder} title="No files of its own here" compact>
              What this folder holds is in its folders, in the bottom left of the window.
            </EmptyState>
          </li>
        )}
        {items.length === 0 && !itemsUnread && (
          <li
            className={cx(
              'rounded-lg border border-dashed',
              lineAt !== null ? 'border-accent' : 'border-line-strong',
            )}
          >
            <EmptyState icon={ListPlus} title="This playlist is empty" compact lamp>
              {simple
                ? 'Drop files here (sounds, videos, pictures, PDFs and PowerPoint or Keynote decks), or use Add files… or From a Link… above.'
                : 'Drag presentations, pictures, videos or files here, use Add files… or From a Link… above, or choose one in the library and press Add to playlist.'}
            </EmptyState>
          </li>
        )}
      </ul>
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
 * order, to drag about, drop library rows and files on, and download into. `simple`: Simple Mode's open playlist
 * (Session 55, Part 18), with only what Simple Mode offers: its rows, one click, dragging, Add files…, From a Link…
 * and files dropped, and the right-click menu's Rename and Delete; no menu of the playlist's own, no Close, no Up,
 * Down or order under a row, no trash buttons, no bar of chosen rows, no header renamed in place, no Edit slides
 * (since Session 56 its folders go through the left column's, and its name is renamed as Pro Mode's is).
 */
export function OpenPlaylist({ platform, simple = false }: { platform: string; simple?: boolean }) {
  const openId = usePlaylists((s) => s.openId);
  if (!openId) return null;
  return <PlaylistItems platform={platform} openId={openId} simple={simple} />;
}
