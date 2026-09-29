import { useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { actionFor, LIBRARY_KEYMAP } from '../../../shared/keymap';
import type { NewItem, PlaylistItemInfo, PlaylistNode } from '../../../shared/playlists';
import { useEngine } from '../engine/engine-store';
import { leaveItem, selectPresentation, useLibrary } from '../library/library-store';
import { mediaKindLabel, mediaProblem } from '../library/MediaList';
import { Button } from '../ui/Button';
import type { MenuEntry, MenuPlace } from '../ui/Menu';
import { Menu, MenuButton, menuPlace } from '../ui/Menu';
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
      className="w-full min-w-0 rounded border border-accent bg-ink px-2 py-1 text-sm text-white outline-none"
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
  const rename = { label: 'Rename…', onSelect: () => startRenaming(node.id) };
  const remove = { label: 'Remove…', danger: true, onSelect: () => requestRemoveNode(node.id) };
  if (!node.isFolder) return [{ label: 'Open', onSelect: () => void openPlaylist(node.id) }, rename, remove];
  return [
    { label: 'New playlist here', onSelect: () => void createNode(false, node.id) },
    { label: 'New folder here', onSelect: () => void createNode(true, node.id) },
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
      <div className="flex items-center gap-1 px-2 pt-3 pb-2">
        <h2 className="flex-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted">Playlists</h2>
        <MenuButton
          label="New"
          title="New playlist or folder"
          entries={[
            { label: 'New playlist', onSelect: () => void createNode(false) },
            { label: 'New folder', onSelect: () => void createNode(true) },
          ]}
        >
          + New
        </MenuButton>
      </div>
      <ul
        role="tree"
        aria-label="Playlists"
        data-testid="playlist-tree"
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
      >
        {tree.length === 0 && (
          <li className="px-2 py-1 text-xs text-muted">
            No playlists yet. Make one with New, or import a playlist file.
          </li>
        )}
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
                className={`flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-8 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-accent ${
                  dropOn === node.id
                    ? 'bg-panel-2 ring-2 ring-accent'
                    : selectedNodeId === node.id
                      ? 'bg-panel-2'
                      : 'hover:bg-panel-2'
                }`}
              >
                <span aria-hidden="true" className="w-3 shrink-0 text-center text-muted">
                  {node.isFolder ? (open ? '▾' : '▸') : '≡'}
                </span>
                <span className={`min-w-0 flex-1 truncate ${node.isFolder ? 'font-semibold' : ''}`}>
                  {node.name}
                </span>
                {node.placeholders > 0 && (
                  <span
                    data-testid="node-placeholders"
                    title={`${node.placeholders} item(s) not found at import`}
                    className="shrink-0 rounded bg-amber-700/80 px-1.5 text-[10px] font-semibold text-white"
                  >
                    {node.placeholders} missing
                  </span>
                )}
                {!node.isFolder && <span className="shrink-0 text-xs text-muted">{node.itemCount}</span>}
              </button>
              <button
                type="button"
                aria-label={`More for ${node.name}`}
                aria-haspopup="menu"
                onClick={(e) => {
                  selectNode(node.id);
                  const box = e.currentTarget.getBoundingClientRect();
                  setMenu({ at: { x: box.left, y: box.bottom + 2 }, node });
                }}
                className="absolute right-1 rounded px-1.5 text-muted opacity-0 group-hover:opacity-100 hover:text-white focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent"
              >
                ⋯
              </button>
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

function ItemBody({ item }: { item: PlaylistItemInfo }) {
  switch (item.kind) {
    case 'header':
      return (
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-3 w-1.5 shrink-0 rounded-sm"
            style={{ background: item.color ?? '#6b7280' }}
          />
          <span data-label className="truncate text-xs font-bold uppercase tracking-wide">
            {item.label}
          </span>
        </span>
      );
    case 'presentation':
      return (
        <>
          <span data-label className="block truncate text-sm font-medium">
            {item.presentationName ?? item.label}
          </span>
          {item.presentationName === null ? (
            <span className="text-xs text-amber-300">Removed from the library</span>
          ) : item.order.mode === 'arrangement' ? (
            <span className="text-xs text-muted">Arrangement: {item.arrangementName ?? ''}</span>
          ) : item.order.mode === 'all' ? (
            <span className="text-xs text-muted">All slides in order</span>
          ) : null}
        </>
      );
    case 'media': {
      const problem = mediaProblem(item);
      return (
        <>
          <span data-label className="block truncate text-sm">
            {item.label}
          </span>
          <span className="flex gap-2 text-xs text-muted">
            {mediaKindLabel[item.media]}
            {problem && <span className="text-amber-300">{problem}</span>}
          </span>
        </>
      );
    }
    case 'placeholder':
      return (
        <>
          <span className="flex items-center gap-1.5 text-sm text-amber-100">
            <span aria-hidden="true">⚠</span>
            <span data-label className="truncate">
              {item.label}
            </span>
          </span>
          <span className="block truncate text-xs text-amber-300">
            Not found at import · drag a presentation here
          </span>
        </>
      );
  }
}

function itemMenu(item: PlaylistItemInfo): MenuEntry[] {
  const remove = {
    label: 'Remove from playlist',
    danger: true,
    onSelect: () => {
      if (!usePlaylists.getState().marked.includes(item.id))
        clickItem(item.id, { toggle: false, range: false });
      void removeMarkedItems();
    },
  };
  if (item.kind === 'header') return [{ label: 'Rename…', onSelect: () => startRenaming(item.id) }, remove];
  if (item.kind === 'presentation' && item.presentationName !== null)
    return [
      {
        label: 'Show in the library',
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
  const liveItem = useEngine((s) =>
    s.state?.live.playlist?.playlistId === openId ? s.state.live.playlist.itemId : null,
  );
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
      <div className="flex items-center gap-1 px-2 pt-3 pb-2">
        <Button
          tone="ghost"
          className="px-2 py-1 text-sm"
          aria-label="All playlists"
          title="All playlists"
          data-testid="playlists-back"
          onClick={closePlaylist}
        >
          ‹
        </Button>
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
            className="min-w-0 flex-1 truncate text-sm font-semibold"
            data-testid="playlist-title"
            title="Double-click to rename"
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
          entries={[
            { label: 'Add a header', onSelect: () => void addHeader() },
            { label: 'Rename playlist…', onSelect: () => startRenaming(openId) },
            { label: 'Remove playlist…', danger: true, onSelect: () => requestRemoveNode(openId) },
          ]}
        >
          ⋯
        </MenuButton>
      </div>
      <ul
        aria-label={`Items in ${node?.name ?? 'the playlist'}`}
        data-testid="playlist-items"
        data-count={items.length}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
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
            item.kind === 'placeholder'
              ? 'border border-dashed border-amber-500 bg-amber-950/40'
              : item.kind === 'header'
                ? 'bg-black/30'
                : '';
          return (
            <li key={item.id} data-item-index={index} className={`mb-1 rounded-md ${line}`}>
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
                className={`w-full rounded-md px-3 py-1.5 text-left transition focus-visible:outline-2 focus-visible:outline-accent ${look} ${
                  filling
                    ? 'ring-2 ring-accent'
                    : isMarked
                      ? 'bg-panel-2 ring-1 ring-accent'
                      : 'hover:bg-panel-2'
                }`}
              >
                <span className="flex items-start gap-2">
                  {isLive && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-live" aria-label="Live" />
                  )}
                  <span className="min-w-0 flex-1">
                    <ItemBody item={item} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {items.length === 0 && (
          <li
            className={`rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted ${
              lineAt !== null ? 'border-accent' : 'border-line'
            }`}
          >
            Drag presentations or media here from the library.
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
    <section
      aria-label="Playlists"
      data-testid="playlists"
      className="flex min-h-0 flex-[1_1_45%] flex-col border-b border-line"
    >
      {openId ? <PlaylistItems platform={platform} openId={openId} /> : <PlaylistTree platform={platform} />}
      {problem && (
        <p role="alert" className="mx-2 mb-2 flex items-start gap-2 text-xs text-amber-200">
          <span className="flex-1">{problem}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-muted hover:text-white"
            onClick={dismissProblem}
          >
            ×
          </button>
        </p>
      )}
    </section>
  );
}
