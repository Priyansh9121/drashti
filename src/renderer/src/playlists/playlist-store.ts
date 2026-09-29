import { create } from 'zustand';
import type { NewItem, PlaylistItemInfo, PlaylistNode, PlaylistResult } from '../../../shared/playlists';
import { useLibrary } from '../library/library-store';
import { describeSome, pushRemoval } from '../library/undo';

/*
 * Playlists as the operator window shows and edits them: the tree of
 * playlists and folders, and the items of the open playlist.
 */

interface PlaylistView {
  tree: PlaylistNode[];
  /** Folders shut in the tree. */
  closed: string[];
  /** The playlist or folder the tree's actions apply to. */
  selectedNodeId: string | null;
  /** The playlist whose items are shown; null shows the tree. */
  openId: string | null;
  items: PlaylistItemInfo[];
  /** Items marked for a list action (drag, remove): the clicked one and any added with Cmd/Ctrl or Shift. */
  marked: string[];
  anchorId: string | null;
  /** The playlist, folder or header being renamed in place. */
  renaming: string | null;
  /** Playlists or folders waiting for the operator to confirm removing them. */
  confirmRemove: { ids: string[]; name: string; folder: boolean; inside: number } | null;
  /** The last problem, until the next change works. */
  problem: string | null;
}

export const usePlaylists = create<PlaylistView>(() => ({
  tree: [],
  closed: [],
  selectedNodeId: null,
  openId: null,
  items: [],
  marked: [],
  anchorId: null,
  renaming: null,
  confirmRemove: null,
  problem: null,
}));

const api = () => window.drashti.playlists;

/** Show a failed change's message; true when it worked. */
function settled(result: PlaylistResult): result is { ok: true; ids: string[] } {
  usePlaylists.setState({ problem: result.ok ? null : result.message });
  return result.ok;
}

export async function loadTree(): Promise<void> {
  const tree = await api().tree();
  const ids = new Set(tree.map((n) => n.id));
  const { openId, selectedNodeId } = usePlaylists.getState();
  usePlaylists.setState({
    tree,
    openId: openId && ids.has(openId) ? openId : null,
    selectedNodeId: selectedNodeId && ids.has(selectedNodeId) ? selectedNodeId : null,
  });
}

export async function loadItems(): Promise<void> {
  const { openId } = usePlaylists.getState();
  if (!openId) {
    usePlaylists.setState({ items: [], marked: [] });
    return;
  }
  const items = await api().items(openId);
  // Ignore a slow answer for a playlist that is no longer open.
  if (usePlaylists.getState().openId !== openId) return;
  const ids = new Set(items.map((i) => i.id));
  usePlaylists.setState((s) => ({
    items,
    marked: s.marked.filter((id) => ids.has(id)),
    anchorId: s.anchorId && ids.has(s.anchorId) ? s.anchorId : null,
  }));
}

async function reload(): Promise<void> {
  await loadTree();
  await loadItems();
}

let watching = false;

/** Follow changes: to playlists, and to the library (a removed presentation shows in its items). */
export function watchPlaylists(): void {
  if (watching) return;
  watching = true;
  window.drashti.playlists.onChanged(() => void reload());
  useLibrary.subscribe((s, before) => {
    if (s.presentations !== before.presentations) void reload();
  });
}

// ---- the tree ------------------------------------------------------------------

export async function openPlaylist(id: string): Promise<void> {
  usePlaylists.setState({ openId: id, selectedNodeId: id, items: [], marked: [], anchorId: null });
  await loadItems();
}

export function closePlaylist(): void {
  usePlaylists.setState({ openId: null, items: [], marked: [], anchorId: null, renaming: null });
}

export function selectNode(id: string): void {
  usePlaylists.setState({ selectedNodeId: id });
}

export function toggleFolder(id: string): void {
  usePlaylists.setState((s) => ({
    closed: s.closed.includes(id) ? s.closed.filter((c) => c !== id) : [...s.closed, id],
    selectedNodeId: id,
  }));
}

/** Where something new goes: in the selected folder, or beside the selected playlist. */
function newParent(): string | null {
  const { tree, selectedNodeId } = usePlaylists.getState();
  const node = tree.find((n) => n.id === selectedNodeId);
  if (!node) return null;
  return node.isFolder ? node.id : node.parentId;
}

/** A new playlist or folder, named for the operator to change straight away. */
export async function createNode(isFolder: boolean, parentId: string | null = newParent()): Promise<void> {
  const result = await api().create(isFolder ? 'New folder' : 'New playlist', parentId, isFolder);
  if (!settled(result)) return;
  const [id] = result.ids;
  await loadTree();
  if (!id) return;
  usePlaylists.setState((s) => ({
    selectedNodeId: id,
    renaming: id,
    closed: s.closed.filter((c) => c !== parentId),
  }));
}

export function startRenaming(id: string): void {
  usePlaylists.setState({ renaming: id });
}

export function stopRenaming(): void {
  usePlaylists.setState({ renaming: null });
}

export async function renameNode(id: string, name: string): Promise<void> {
  stopRenaming();
  const node = usePlaylists.getState().tree.find((n) => n.id === id);
  if (!node || name.trim() === '' || name.trim() === node.name) return;
  if (settled(await api().rename(id, name))) await loadTree();
}

/** Everything inside a folder, at any depth. */
function inside(tree: readonly PlaylistNode[], id: string): PlaylistNode[] {
  const out: PlaylistNode[] = [];
  const walk = (parentId: string) => {
    for (const n of tree)
      if (n.parentId === parentId) {
        out.push(n);
        if (n.isFolder) walk(n.id);
      }
  };
  walk(id);
  return out;
}

/** Ask before removing a playlist or a folder (with what it holds). */
export function requestRemoveNode(id: string): void {
  const { tree } = usePlaylists.getState();
  const node = tree.find((n) => n.id === id);
  if (!node) return;
  usePlaylists.setState({
    confirmRemove: {
      ids: [id],
      name: node.name,
      folder: node.isFolder,
      inside: inside(tree, id).filter((n) => !n.isFolder).length,
    },
  });
}

export function cancelRemoveNode(): void {
  usePlaylists.setState({ confirmRemove: null });
}

export async function confirmRemoveNode(): Promise<void> {
  const pending = usePlaylists.getState().confirmRemove;
  if (!pending) return;
  usePlaylists.setState({ confirmRemove: null });
  const result = await api().remove(pending.ids);
  if (!settled(result) || result.ids.length === 0) return;
  const removed = result.ids;
  pushRemoval({
    text: `Removed ${pending.folder ? 'folder' : 'playlist'} “${pending.name}”`,
    restore: async () => {
      await api().restore(removed);
      await loadTree();
      usePlaylists.setState({ selectedNodeId: removed[0] ?? null });
    },
  });
  await reload();
}

// ---- the open playlist's items ----------------------------------------------------

/** A click on an item: a plain click marks one; Cmd/Ctrl adds or takes one away; Shift marks a range. */
export function clickItem(id: string, mods: { toggle: boolean; range: boolean }): void {
  const { items, marked, anchorId } = usePlaylists.getState();
  if (mods.range && anchorId) {
    const ids = items.map((i) => i.id);
    const from = ids.indexOf(anchorId);
    const to = ids.indexOf(id);
    if (from >= 0 && to >= 0) {
      usePlaylists.setState({ marked: ids.slice(Math.min(from, to), Math.max(from, to) + 1) });
      return;
    }
  }
  if (mods.toggle) {
    const set = new Set(marked);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    usePlaylists.setState({ marked: [...set], anchorId: id });
    return;
  }
  usePlaylists.setState({ marked: [id], anchorId: id });
}

/** The items a drag or Delete acts on: the marked ones, in playlist order. */
export function markedItems(): PlaylistItemInfo[] {
  const { items, marked } = usePlaylists.getState();
  return items.filter((i) => marked.includes(i.id));
}

/** Add presentations, media or a header to a playlist, at a position or at the end. */
export async function addItems(playlistId: string, at: number | null, items: NewItem[]): Promise<string[]> {
  if (items.length === 0) return [];
  const result = await api().addItems(playlistId, at, items);
  if (!settled(result)) return [];
  await reload();
  if (usePlaylists.getState().openId === playlistId)
    usePlaylists.setState({ marked: result.ids, anchorId: result.ids[0] ?? null });
  return result.ids;
}

/** A header after the marked items (or at the end), named for the operator to change. */
export async function addHeader(): Promise<void> {
  const { openId, items, marked } = usePlaylists.getState();
  if (!openId) return;
  const last = items.findLastIndex((i) => marked.includes(i.id));
  const [id] = await addItems(openId, last >= 0 ? last + 1 : null, [{ kind: 'header', label: 'New header' }]);
  if (id) usePlaylists.setState({ renaming: id });
}

export async function renameHeader(id: string, label: string): Promise<void> {
  stopRenaming();
  const item = usePlaylists.getState().items.find((i) => i.id === id);
  if (!item || label.trim() === '' || label.trim() === item.label) return;
  if (settled(await api().renameHeader(id, label))) await loadItems();
}

/** Move items so they land before the item now at `at` (the end when it is past the last). */
export async function moveItems(ids: string[], at: number): Promise<void> {
  const { openId, items } = usePlaylists.getState();
  if (!openId || ids.length === 0) return;
  // The position among the items that stay.
  const to = items.slice(0, at).filter((i) => !ids.includes(i.id)).length;
  if (settled(await api().moveItems(openId, ids, to))) await loadItems();
}

/** Remove the marked items; Undo brings them back where they were. */
export async function removeMarkedItems(): Promise<void> {
  const { openId, tree } = usePlaylists.getState();
  const items = markedItems();
  if (!openId || items.length === 0) return;
  const result = await api().removeItems(items.map((i) => i.id));
  if (!settled(result) || result.ids.length === 0) return;
  const removed = result.ids;
  const playlist = tree.find((n) => n.id === openId)?.name ?? 'the playlist';
  pushRemoval({
    text: `Removed ${describeSome(
      items.map((i) => i.label),
      removed.length,
      'item',
    )} from “${playlist}”`,
    restore: async () => {
      await api().restoreItems(removed);
      if (usePlaylists.getState().openId !== openId) await openPlaylist(openId);
      await reload();
      usePlaylists.setState({ marked: removed, anchorId: removed[0] ?? null });
    },
  });
  await reload();
}

/**
 * Presentations dropped on a placeholder: the first takes its place, and any
 * others follow it.
 */
export async function fillPlaceholder(itemId: string, presentationIds: string[]): Promise<void> {
  const { openId, items } = usePlaylists.getState();
  const [first, ...rest] = presentationIds;
  if (!openId || !first) return;
  if (!settled(await api().fillPlaceholder(itemId, first))) return;
  const at = items.findIndex((i) => i.id === itemId);
  if (rest.length > 0)
    await addItems(
      openId,
      at + 1,
      rest.map((presentationId) => ({ kind: 'presentation', presentationId })),
    );
  await reload();
  usePlaylists.setState({ marked: [itemId], anchorId: itemId });
}

export function dismissProblem(): void {
  usePlaylists.setState({ problem: null });
}
