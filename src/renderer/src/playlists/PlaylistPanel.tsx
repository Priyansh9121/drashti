import { useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { actionFor, LIBRARY_KEYMAP } from '../../../shared/keymap';
import type { NewItem, PlaylistItemInfo, TimerCue, PlaylistNode } from '../../../shared/playlists';
import { useEngine } from '../engine/engine-store';
import { leaveItem, selectPresentation, useLibrary } from '../library/library-store';
import { mediaKindIcon, mediaKindLabel, mediaProblem } from '../library/MediaList';
import { Badge, LiveBadge, MissingBadge, UnplayableBadge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import {
  Timer,
  ArrowDown,
  ArrowUp,
  BookOpen,
  AlertTriangle,
  BookTemplate,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderPlus,
  ListMusic,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Presentation,
  SquareDashed,
  Trash2,
} from '../ui/icons';
import { controlClass } from '../ui/Field';
import type { MenuEntry, MenuPlace } from '../ui/Menu';
import { isMenuKey, Menu, MenuButton, menuBelow, menuPlace } from '../ui/Menu';
import { Notice } from '../ui/Notice';
import { rowClass } from '../ui/ListRow';
import { EmptyState } from '../ui/States';
import { TabPanel, Tabs } from '../ui/Tabs';
import { Truncate } from '../ui/Truncate';
import { dragKind, droppedIds, startDrag, useDragging } from './drag';
import {
  AddSlotDialog,
  EditSlotDialog,
  FillSlotDialog,
  SaveTemplateDialog,
  TimerCuesDialog,
} from './TemplateDialogs';
import {
  addFromLibrary,
  addHeader,
  clickItem,
  closePlaylist,
  createNode,
  dismissProblem,
  fillPlaceholder,
  itemName,
  markedItems,
  moveItemBy,
  moveItems,
  newFromTemplate,
  openPlaylist,
  pickItem,
  removeMarkedItems,
  renameHeader,
  renameNode,
  requestRemoveNode,
  selectNode,
  setView,
  startRenaming,
  stopRenaming,
  templateOpen,
  toggleFolder,
  usePlaylists,
} from './playlist-store';
import { plural } from '../ui/text';
import { useWhatIsThis } from '../help/WhatIsThis';

/** A name edited in place: Enter or leaving the field keeps it, Esc goes back. */
function RenameField({
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
function droppedItems(e: DragEvent): NewItem[] {
  const kind = dragKind(e);
  if (kind === 'presentations')
    return droppedIds(e, kind).map((presentationId) => ({ kind: 'presentation', presentationId }));
  if (kind === 'media') return droppedIds(e, kind).map((mediaId) => ({ kind: 'media', mediaId }));
  if (kind === 'passages') return droppedIds(e, kind).map((passageId) => ({ kind: 'shastra', passageId }));
  return [];
}

const fromLibrary = (e: DragEvent) => {
  const kind = dragKind(e);
  return kind === 'presentations' || kind === 'media' || kind === 'passages';
};

const isRemoveKey = (e: KeyboardEvent, platform: string) =>
  !e.repeat && actionFor(e.nativeEvent, platform, LIBRARY_KEYMAP) === 'removeSelected';

// ---- the tree of playlists and folders ------------------------------------------------

function nodeMenu(node: PlaylistNode): MenuEntry[] {
  const rename = { label: 'Rename…', icon: Pencil, onSelect: () => startRenaming(node.id) };
  if (node.template)
    return [
      { label: 'Open', icon: BookTemplate, onSelect: () => void openPlaylist(node.id) },
      { label: 'New playlist from this', icon: ListPlus, onSelect: () => void newFromTemplate(node.id) },
      rename,
      {
        label: 'Remove…',
        icon: Trash2,
        danger: true,
        separatorBefore: true,
        onSelect: () => requestRemoveNode(node.id),
      },
    ];
  const remove = {
    label: 'Remove…',
    icon: Trash2,
    danger: true,
    separatorBefore: true,
    onSelect: () => requestRemoveNode(node.id),
  };
  if (!node.isFolder)
    return [{ label: 'Open', icon: ListMusic, onSelect: () => void openPlaylist(node.id) }, rename, remove];
  return [
    { label: 'New playlist here', icon: ListPlus, onSelect: () => void createNode(false, node.id) },
    { label: 'New folder here', icon: FolderPlus, onSelect: () => void createNode(true, node.id) },
    rename,
    remove,
  ];
}

function PlaylistTree({ platform }: { platform: string }) {
  const tree = usePlaylists((s) => s.tree);
  const closed = usePlaylists((s) => s.closed);
  const selectedNodeId = usePlaylists((s) => s.selectedNodeId);
  const renaming = usePlaylists((s) => s.renaming);
  const [menu, setMenu] = useState<{ at: MenuPlace; node: PlaylistNode } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const help = useWhatIsThis('playlists');

  // The rows to show: everything not inside a shut folder, with how deep it is.
  /** Folders' names, for a screen reader: a playlist in a folder says which. */
  const nameOf = useMemo(() => new Map(tree.map((n) => [n.id, n.name])), [tree]);
  const rows = useMemo(() => {
    const depth = new Map<string, number>();
    const hidden = new Set<string>();
    const out: { node: PlaylistNode; depth: number }[] = [];
    for (const node of tree) {
      const parent = node.parentId;
      const d = parent === null ? 0 : (depth.get(parent) ?? -1) + 1;
      depth.set(node.id, d);
      if (parent !== null && (hidden.has(parent) || closed.includes(parent))) {
        hidden.add(node.id);
        continue;
      }
      out.push({ node, depth: d });
    }
    return out;
  }, [tree, closed]);

  const openMenu = (e: MouseEvent, node: PlaylistNode) => {
    e.preventDefault();
    selectNode(node.id);
    setMenu({ at: menuPlace(e), node });
  };

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-1 px-3">
        <ViewTabs />
        <MenuButton
          label="New"
          title="New playlist or folder"
          icon={FolderPlus}
          entries={[
            { label: 'New playlist', icon: ListPlus, onSelect: () => void createNode(false) },
            { label: 'New folder', icon: FolderPlus, onSelect: () => void createNode(true) },
          ]}
        />
        {help.button}
      </div>
      {help.card}
      <TabPanel group="playlist-view" id="playlists" className="flex min-h-0 flex-1 flex-col">
        {/* An empty tree is no tree: the note stands on its own until there are playlists. */}
        {tree.length === 0 && (
          <div data-testid="playlist-tree" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <EmptyState icon={ListMusic} title="No playlists yet" compact>
              Make one with the New button above, or import a playlist file.
            </EmptyState>
          </div>
        )}
        {/* A list of buttons, each a Tab stop, not an ARIA tree: a tree's arrow keys would take the
            show's own (the arrows move the slides wherever the keyboard is). Folders say whether they
            are open, and a playlist in a folder says which. */}
        <ul
          aria-label="Playlists and folders"
          data-testid={tree.length > 0 ? 'playlist-tree' : undefined}
          hidden={tree.length === 0}
          className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2"
        >
          {rows.map(({ node, depth }) => {
            const open = node.isFolder && !closed.includes(node.id);
            const indent = { paddingLeft: 8 + depth * 14 };
            if (renaming === node.id)
              return (
                <li key={node.id} className="py-0.5" style={indent}>
                  <RenameField
                    value={node.name}
                    label={node.isFolder ? 'Folder name' : 'Playlist name'}
                    onDone={(name) => {
                      if (name === null) stopRenaming();
                      else void renameNode(node.id, name);
                    }}
                  />
                </li>
              );
            return (
              <li key={node.id} className="group relative flex items-center">
                <button
                  type="button"
                  data-testid="playlist-node"
                  data-kind={node.isFolder ? 'folder' : 'playlist'}
                  data-node-id={node.id}
                  aria-expanded={node.isFolder ? open : undefined}
                  aria-current={selectedNodeId === node.id ? 'true' : undefined}
                  style={indent}
                  onClick={() => {
                    if (node.isFolder) toggleFolder(node.id);
                    else void openPlaylist(node.id);
                  }}
                  onContextMenu={(e) => {
                    openMenu(e, node);
                  }}
                  onKeyDown={(e) => {
                    if (isMenuKey(e)) {
                      e.preventDefault();
                      selectNode(node.id);
                      setMenu({ at: menuBelow(e.currentTarget), node });
                      return;
                    }
                    if (!isRemoveKey(e, platform)) return;
                    e.preventDefault();
                    requestRemoveNode(node.id);
                  }}
                  onDragOver={(e) => {
                    if (node.isFolder || !fromLibrary(e)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    setDropOn(node.id);
                  }}
                  onDragLeave={() => {
                    setDropOn(null);
                  }}
                  onDrop={(e) => {
                    setDropOn(null);
                    if (node.isFolder || !fromLibrary(e)) return;
                    e.preventDefault();
                    void addFromLibrary(node.id, null, droppedItems(e));
                  }}
                  className={cx(
                    rowClass({ selected: selectedNodeId === node.id, dropTarget: dropOn === node.id }),
                    'flex min-h-8 min-w-0 items-center gap-1.5 py-1 pr-9 text-sm',
                  )}
                >
                  <span aria-hidden="true" className="flex w-4 shrink-0 justify-center text-muted">
                    {node.isFolder ? open ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-muted">
                    {node.isFolder ? <Folder size={15} /> : <ListMusic size={15} />}
                  </span>
                  <Truncate text={node.name} className={cx('flex-1', node.isFolder && 'font-medium')} />
                  {node.parentId !== null && (
                    <span className="sr-only">, in {nameOf.get(node.parentId) ?? 'a folder'}</span>
                  )}
                  {node.placeholders > 0 && (
                    <Badge
                      tone="warning"
                      data-testid="node-placeholders"
                      title={`${plural(node.placeholders, 'item')} not found at import`}
                    >
                      {node.placeholders} missing
                    </Badge>
                  )}
                  {!node.isFolder && (
                    <span className="shrink-0 text-xs text-muted tabular-nums">{node.itemCount}</span>
                  )}
                </button>
                {/* For the mouse: the keyboard opens the same menu on the playlist itself (Shift+F10 or
                  the Menu key), which keeps one Tab stop a row. */}
                <span className="absolute right-1 opacity-0 group-hover:opacity-100" aria-hidden="true">
                  <IconButton
                    icon={MoreHorizontal}
                    label={`More for ${node.name}`}
                    size="sm"
                    tabIndex={-1}
                    aria-haspopup="menu"
                    onClick={(e) => {
                      selectNode(node.id);
                      const box = e.currentTarget.getBoundingClientRect();
                      setMenu({ at: { x: box.left, y: box.bottom + 2 }, node });
                    }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      </TabPanel>
      {menu && (
        <Menu
          at={menu.at}
          label={menu.node.name}
          entries={nodeMenu(menu.node)}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
    </>
  );
}

/** The week's playlists, or the sabha templates (kept apart, so a template is never run by mistake). */
function ViewTabs() {
  const view = usePlaylists((s) => s.view);
  return (
    <Tabs
      group="playlist-view"
      label="Playlists or templates"
      size="sm"
      // In a narrow column (or large text) the tabs give way, their words whole in a tooltip, so New
      // and What is this? beside them stay in reach.
      shrink
      className="min-w-0 flex-1"
      value={view}
      onChange={setView}
      items={[
        { id: 'playlists', label: 'Playlists', icon: ListMusic },
        { id: 'templates', label: 'Templates', icon: BookTemplate },
      ]}
    />
  );
}

/** The sabha templates: running orders to make playlists from. */
function TemplateList() {
  const templates = usePlaylists((s) => s.templates);
  const [menu, setMenu] = useState<{ at: MenuPlace; node: PlaylistNode } | null>(null);
  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-1 px-3">
        <ViewTabs />
      </div>
      <TabPanel group="playlist-view" id="templates" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <p className="px-1 pb-2 text-xs text-muted">
          A template is a running order with slots to fill. Make the week’s playlist from one; a template
          itself never goes on the screens.
        </p>
        {templates.length === 0 ? (
          <EmptyState icon={BookTemplate} title="No templates yet" compact>
            Open a playlist and choose Save as template in its menu.
          </EmptyState>
        ) : (
          <ul className="space-y-1" aria-label="Templates" data-testid="template-list">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="template-node"
                  className={cx(
                    rowClass({}),
                    'flex min-h-9 min-w-0 flex-1 items-center gap-1.5 px-2 text-sm',
                  )}
                  onClick={() => void openPlaylist(t.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ at: menuPlace(e), node: t });
                  }}
                  onKeyDown={(e) => {
                    if (!isMenuKey(e)) return;
                    e.preventDefault();
                    setMenu({ at: menuBelow(e.currentTarget), node: t });
                  }}
                >
                  <BookTemplate size={15} aria-hidden="true" className="shrink-0 text-muted" />
                  <Truncate text={t.name} className="flex-1" />
                  <span className="shrink-0 text-xs text-muted tabular-nums">{t.itemCount}</span>
                </button>
                <Button
                  size="sm"
                  icon={ListPlus}
                  data-testid="new-from-template"
                  aria-label={`New playlist from ${t.name}`}
                  onClick={() => void newFromTemplate(t.id)}
                >
                  Use
                </Button>
              </li>
            ))}
          </ul>
        )}
      </TabPanel>
      {menu && (
        <Menu
          at={menu.at}
          label={menu.node.name}
          entries={nodeMenu(menu.node)}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
    </>
  );
}

// ---- the open playlist's items ----------------------------------------------------------

/** Where a drag would land: before the item at `at` (or at the end), or on a placeholder to fill it. */
type DropSpot = { at: number } | { fill: string };

function ItemBody({ item, live }: { item: PlaylistItemInfo; live: boolean }) {
  const liveBadge = live ? <LiveBadge /> : null;
  switch (item.kind) {
    case 'header':
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
    case 'presentation':
      return (
        <span className="flex items-center gap-2">
          <Presentation size={15} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span
              data-label
              title={item.presentationName ?? item.label}
              className="block truncate text-sm font-medium"
            >
              {item.presentationName ?? item.label}
            </span>
            {item.presentationName === null ? (
              <span className="text-xs text-warning-fg">Removed from the library</span>
            ) : item.order.mode === 'arrangement' ? (
              <span className="block truncate text-xs text-muted">
                Arrangement: {item.arrangementName ?? ''}
              </span>
            ) : item.order.mode === 'all' ? (
              <span className="text-xs text-muted">All slides in order</span>
            ) : null}
            <CuesLine cues={item.timers} />
          </span>
          {liveBadge}
        </span>
      );
    case 'media': {
      const problem = mediaProblem(item);
      const KindIcon = mediaKindIcon[item.media];
      return (
        <span className="flex items-center gap-2">
          <KindIcon size={15} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span data-label title={item.label} className="block truncate text-sm">
              {item.label}
            </span>
            <span className="text-xs text-muted">{mediaKindLabel[item.media]}</span>
            <CuesLine cues={item.timers} />
          </span>
          {item.missing ? <MissingBadge /> : problem && <UnplayableBadge />}
          {liveBadge}
        </span>
      );
    }
    case 'shastra':
      return (
        <span className="flex items-center gap-2">
          <BookOpen size={15} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span data-label title={item.label} className="block truncate text-sm font-medium">
              {item.label}
            </span>
            {item.missing ? (
              <span className="text-xs text-warning-fg">Its Shastra text is not loaded</span>
            ) : (
              <span className="text-xs text-muted">Shastra passage</span>
            )}
            <CuesLine cues={item.timers} />
          </span>
          {liveBadge}
        </span>
      );
    case 'placeholder':
      if (item.hint === null)
        return (
          <span className="flex items-center gap-2">
            <SquareDashed size={15} aria-hidden="true" className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span data-label title={item.label} className="block truncate text-sm">
                {item.label}
              </span>
              <span className="block truncate text-xs text-muted">
                A slot{item.category ? ` · ${item.category}` : ''} · choose what goes here
              </span>
            </span>
          </span>
        );
      return (
        <span className="flex items-center gap-2">
          <AlertTriangle size={15} aria-hidden="true" className="shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <span data-label title={item.label} className="block truncate text-sm text-warning-fg">
              {item.label}
            </span>
            <span className="block truncate text-xs text-warning-fg">
              Not found at import · drag a presentation here
            </span>
          </span>
        </span>
      );
  }
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
 * where the operator has gone since, even beside it (Tab from the item to Down).
 */
function keepFocus(id: string, on: 'item' | 'up' | 'down'): void {
  requestAnimationFrame(() => {
    const row = document.querySelector(`[data-item-row="${CSS.escape(id)}"]`);
    const now = document.activeElement;
    const lost =
      now === null ||
      now === document.body ||
      (now instanceof HTMLButtonElement && now.disabled && (row?.contains(now) ?? false));
    if (!row || !lost) return;
    const button =
      on === 'item' ? null : row.querySelector<HTMLElement>(`[data-move="${on}"]:not(:disabled)`);
    (button ?? row.querySelector<HTMLElement>('[data-testid="playlist-item"]'))?.focus();
  });
}

/**
 * Up and Down on the chosen item, on a line under it so its name keeps its room: it moves a place,
 * as one Undo step, without dragging (Alt+↑ ↓ too).
 */
function MoveButtons({
  name,
  first,
  last,
  onMove,
}: {
  name: string;
  first: boolean;
  last: boolean;
  onMove: (step: -1 | 1, on: 'up' | 'down') => void;
}) {
  return (
    <span
      role="group"
      aria-label={`Move “${name}”`}
      data-testid="playlist-item-moves"
      className="mt-1 mb-1 flex justify-end gap-1"
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
  const items = usePlaylists((s) => s.items);
  const marked = usePlaylists((s) => s.marked);
  const anchorId = usePlaylists((s) => s.anchorId);
  const dragging = useDragging((s) => s.on);
  const renaming = usePlaylists((s) => s.renaming);
  const [spot, setSpot] = useState<DropSpot | null>(null);
  const [menu, setMenu] = useState<{ at: MenuPlace; item: PlaylistItemInfo } | null>(null);
  const markedSet = new Set(marked);
  // The item on the screens now: the playlist's place, while something of it is up (not after Clear all).
  const liveItem = useEngine((s) => {
    const st = s.state;
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
    if (!kind) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = kind === 'items' ? 'move' : 'copy';
    const next = spotFor(e);
    if (!sameSpot(spot, next)) setSpot(next);
  };
  const onDrop = (e: DragEvent) => {
    const kind = dragKind(e);
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
    <>
      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        <IconButton
          icon={ChevronLeft}
          label="All playlists"
          size="sm"
          data-testid="playlists-back"
          onClick={closePlaylist}
        />
        {renaming === openId ? (
          <RenameField
            value={node?.name ?? ''}
            label="Playlist name"
            onDone={(name) => {
              if (name === null) stopRenaming();
              else void renameNode(openId, name);
            }}
          />
        ) : (
          <h2
            className="min-w-0 flex-1 truncate text-sm font-bold"
            data-testid="playlist-title"
            title={`${node?.name ?? ''} (double-click to rename)`}
            onDoubleClick={() => {
              startRenaming(openId);
            }}
          >
            {node?.name ?? ''}
          </h2>
        )}
        <MenuButton
          label="Playlist"
          title="Playlist actions"
          icon={MoreHorizontal}
          entries={[
            { label: 'Add a header', icon: ListPlus, onSelect: () => void addHeader() },
            {
              label: 'Add a slot…',
              icon: SquareDashed,
              onSelect: () => {
                usePlaylists.setState({ addingSlot: true });
              },
            },
            ...(isTemplate
              ? [
                  {
                    label: 'New playlist from this',
                    icon: ListPlus,
                    separatorBefore: true,
                    onSelect: () => void newFromTemplate(openId),
                  },
                ]
              : [
                  {
                    label: 'Save as template…',
                    icon: BookTemplate,
                    separatorBefore: true,
                    onSelect: () => {
                      usePlaylists.setState({ savingTemplate: openId });
                    },
                  },
                ]),
            {
              label: isTemplate ? 'Rename template…' : 'Rename playlist…',
              icon: Pencil,
              onSelect: () => startRenaming(openId),
            },
            {
              label: isTemplate ? 'Remove template…' : 'Remove playlist…',
              icon: Trash2,
              danger: true,
              separatorBefore: true,
              onSelect: () => requestRemoveNode(openId),
            },
          ]}
        />
      </div>
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
        aria-label={`Items in ${node?.name ?? 'the playlist'}`}
        data-testid="playlist-items"
        data-count={items.length}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2"
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSpot(null);
        }}
        onDrop={onDrop}
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
            void moveItemBy(item.id, step).then((moved) => {
              if (moved || on === 'item') keepFocus(item.id, on);
            });
          };
          return (
            <li
              key={item.id}
              data-item-index={index}
              data-item-row={item.id}
              className={cx('rounded-md', line)}
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
                  if (!ours) clickItem(item.id, { toggle: false, range: false });
                }}
                className={cx(
                  rowClass({ selected: shownItem === item.id, marked: isMarked, dropTarget: filling }),
                  'px-2.5',
                  item.kind === 'header' ? 'min-h-8 pt-2 pb-1' : 'min-h-11 py-1.5',
                  look,
                )}
              >
                <ItemBody item={item} live={isLive} />
              </button>
              {isMarked && anchorId === item.id && !dragging && (
                <MoveButtons
                  name={itemName(item)}
                  first={index === 0}
                  last={index === items.length - 1}
                  onMove={move}
                />
              )}
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
            <EmptyState icon={ListPlus} title="This playlist is empty" compact>
              Drag presentations, media or Shastra passages here from the library, or choose one there and
              press Add to playlist.
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
    </>
  );
}

export function PlaylistPanel({ platform }: { platform: string }) {
  const openId = usePlaylists((s) => s.openId);
  const view = usePlaylists((s) => s.view);
  const problem = usePlaylists((s) => s.problem);
  return (
    <section aria-label="Playlists" data-testid="playlists" className="flex min-h-0 flex-1 flex-col">
      {openId ? (
        <PlaylistItems platform={platform} openId={openId} />
      ) : view === 'templates' ? (
        <TemplateList />
      ) : (
        <PlaylistTree platform={platform} />
      )}
      <SaveTemplateDialog />
      <AddSlotDialog />
      <FillSlotDialog />
      <EditSlotDialog />
      <TimerCuesDialog />
      {problem && (
        <Notice tone="warning" compact className="mx-2 mb-2" onDismiss={dismissProblem}>
          {problem}
        </Notice>
      )}
    </section>
  );
}
