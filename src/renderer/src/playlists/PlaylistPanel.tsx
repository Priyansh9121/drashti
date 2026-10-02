import { useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { actionFor, LIBRARY_KEYMAP } from '../../../shared/keymap';
import type { NewItem, PlaylistItemInfo, PlaylistNode } from '../../../shared/playlists';
import { useEngine } from '../engine/engine-store';
import { leaveItem, selectPresentation, useLibrary } from '../library/library-store';
import { mediaKindIcon, mediaKindLabel, mediaProblem } from '../library/MediaList';
import { Badge, LiveBadge, MissingBadge, UnplayableBadge } from '../ui/Badge';
import { IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import {
  AlertTriangle,
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
  Trash2,
} from '../ui/icons';
import { controlClass } from '../ui/Field';
import type { MenuEntry, MenuPlace } from '../ui/Menu';
import { Menu, MenuButton, menuPlace } from '../ui/Menu';
import { Notice } from '../ui/Notice';
import { rowClass } from '../ui/ListRow';
import { EmptyState } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { dragKind, droppedIds, startDrag } from './drag';
import {
  addHeader,
  addItems,
  clickItem,
  closePlaylist,
  createNode,
  dismissProblem,
  fillPlaceholder,
  markedItems,
  moveItems,
  openPlaylist,
  pickItem,
  removeMarkedItems,
  renameHeader,
  renameNode,
  requestRemoveNode,
  selectNode,
  startRenaming,
  stopRenaming,
  toggleFolder,
  usePlaylists,
} from './playlist-store';

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
  return [];
}

const fromLibrary = (e: DragEvent) => {
  const kind = dragKind(e);
  return kind === 'presentations' || kind === 'media';
};

const isRemoveKey = (e: KeyboardEvent, platform: string) =>
  !e.repeat && actionFor(e.nativeEvent, platform, LIBRARY_KEYMAP) === 'removeSelected';

// ---- the tree of playlists and folders ------------------------------------------------

function nodeMenu(node: PlaylistNode): MenuEntry[] {
  const rename = { label: 'Rename…', icon: Pencil, onSelect: () => startRenaming(node.id) };
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

  // The rows to show: everything not inside a shut folder, with how deep it is.
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
        <h2 className="flex flex-1 items-center gap-1.5 text-2xs font-bold tracking-wider text-muted uppercase">
          <ListMusic size={14} aria-hidden="true" />
          Playlists
        </h2>
        <MenuButton
          label="New"
          title="New playlist or folder"
          icon={FolderPlus}
          entries={[
            { label: 'New playlist', icon: ListPlus, onSelect: () => void createNode(false) },
            { label: 'New folder', icon: FolderPlus, onSelect: () => void createNode(true) },
          ]}
        />
      </div>
      {/* An empty tree is no tree: the note stands on its own until there are playlists. */}
      {tree.length === 0 && (
        <div data-testid="playlist-tree" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <EmptyState icon={ListMusic} title="No playlists yet" compact>
            Make one with the New button above, or import a playlist file.
          </EmptyState>
        </div>
      )}
      <ul
        role="tree"
        aria-label="Playlists"
        data-testid={tree.length > 0 ? 'playlist-tree' : undefined}
        hidden={tree.length === 0}
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2"
      >
        {rows.map(({ node, depth }) => {
          const open = node.isFolder && !closed.includes(node.id);
          const indent = { paddingLeft: 8 + depth * 14 };
          if (renaming === node.id)
            return (
              <li key={node.id} role="none" className="py-0.5" style={indent}>
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
            <li key={node.id} role="none" className="group relative flex items-center">
              <button
                type="button"
                role="treeitem"
                data-testid="playlist-node"
                data-kind={node.isFolder ? 'folder' : 'playlist'}
                data-node-id={node.id}
                aria-level={depth + 1}
                aria-expanded={node.isFolder ? open : undefined}
                aria-selected={selectedNodeId === node.id}
                style={indent}
                onClick={() => {
                  if (node.isFolder) toggleFolder(node.id);
                  else void openPlaylist(node.id);
                }}
                onContextMenu={(e) => {
                  openMenu(e, node);
                }}
                onKeyDown={(e) => {
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
                  void addItems(node.id, null, droppedItems(e));
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
                {node.placeholders > 0 && (
                  <Badge
                    tone="warning"
                    data-testid="node-placeholders"
                    title={`${node.placeholders} item(s) not found at import`}
                  >
                    {node.placeholders} missing
                  </Badge>
                )}
                {!node.isFolder && (
                  <span className="shrink-0 text-xs text-muted tabular-nums">{node.itemCount}</span>
                )}
              </button>
              {/* For the mouse: the keyboard opens the same menu on the playlist itself (Shift+F10 or
                  the Menu key), since a tree may hold only its items. */}
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
            className="min-w-0 flex-1 truncate text-2xs font-bold tracking-wider text-muted uppercase"
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
          </span>
          {item.missing ? <MissingBadge /> : problem && <UnplayableBadge />}
          {liveBadge}
        </span>
      );
    }
    case 'placeholder':
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
      remove,
    ];
  return [remove];
}

function PlaylistItems({ platform, openId }: { platform: string; openId: string }) {
  const node = usePlaylists((s) => s.tree.find((n) => n.id === openId));
  const items = usePlaylists((s) => s.items);
  const marked = usePlaylists((s) => s.marked);
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
    if (dragKind(e) === 'presentations' && item?.kind === 'placeholder' && part > 0.2 && part < 0.8)
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
    if ('fill' in where) void fillPlaceholder(where.fill, droppedIds(e, 'presentations'));
    else void addItems(openId, where.at, droppedItems(e));
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
            { label: 'Rename playlist…', icon: Pencil, onSelect: () => startRenaming(openId) },
            {
              label: 'Remove playlist…',
              icon: Trash2,
              danger: true,
              separatorBefore: true,
              onSelect: () => requestRemoveNode(openId),
            },
          ]}
        />
      </div>
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
          const look = item.kind === 'placeholder' ? 'border-dashed border-warning/70! bg-warning-bg/60' : '';
          return (
            <li key={item.id} data-item-index={index} className={`rounded-md ${line}`}>
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
                aria-label={
                  item.kind === 'placeholder'
                    ? `Not found: ${item.label}. Drag a presentation here to replace it.`
                    : undefined
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
                  if (!isRemoveKey(e, platform)) return;
                  e.preventDefault();
                  if (!usePlaylists.getState().marked.includes(item.id))
                    clickItem(item.id, { toggle: false, range: false });
                  void removeMarkedItems();
                }}
                onDragStart={(e) => {
                  if (!usePlaylists.getState().marked.includes(item.id))
                    clickItem(item.id, { toggle: false, range: false });
                  startDrag(
                    e,
                    'items',
                    markedItems().map((i) => i.id),
                  );
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
              Drag presentations or media here from the library.
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
  const problem = usePlaylists((s) => s.problem);
  return (
    <section aria-label="Playlists" data-testid="playlists" className="flex min-h-0 flex-1 flex-col">
      {openId ? <PlaylistItems platform={platform} openId={openId} /> : <PlaylistTree platform={platform} />}
      {problem && (
        <Notice tone="warning" compact className="mx-2 mb-2" onDismiss={dismissProblem}>
          {problem}
        </Notice>
      )}
    </section>
  );
}
