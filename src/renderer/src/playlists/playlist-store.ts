import { create } from 'zustand';
import type { PlaylistCursor } from '../../../shared/engine/state';
import type {
  ItemOrder,
  NewItem,
  PlaylistItemInfo,
  PlaylistNode,
  PlaylistResult,
  TimerCue,
} from '../../../shared/playlists';
import { POSITION_MAX } from '../../../shared/playlists';
import { itemsMadeBy } from '../../../shared/import-items';
import { useEngine } from '../engine/engine-store';
import { importPaths } from '../library/import-store';
import { leaveItem, showItem, showRepeatSteps, useLibrary } from '../library/library-store';
import { isRepeatId, repeatPresentationId, type RepeatSettings } from '../../../shared/repeat';
import { describeSome, pushRemoval } from '../library/undo';
import { folderEnd, hasFolder, playlistFolders } from '../../../shared/playlist-folders';

/*
 * Playlists as the operator window shows and edits them: the tree of
 * playlists and folders, and the items of the open playlist.
 */

interface PlaylistView {
  /** The week's playlists, or the sabha templates (kept apart, never run). */
  view: 'playlists' | 'templates';
  tree: PlaylistNode[];
  templates: PlaylistNode[];
  /** Folders shut in the tree. */
  closed: string[];
  /** The playlist or folder the tree's actions apply to. */
  selectedNodeId: string | null;
  /** Playlists and folders chosen together (Session 44): Delete removes them all, with one Undo. */
  markedNodes: string[];
  nodeAnchor: string | null;
  /** The playlist whose items are shown; null shows the tree. */
  openId: string | null;
  items: PlaylistItemInfo[];
  /**
   * The folder of the open folder playlist shown in the middle (Session 44): its path as its header names it
   * ("Week 1 › Videos"), '' for the top folder. Its subfolders show in the bottom left.
   */
  folder: string;
  /** Items marked for a list action (drag, remove): the clicked one and any added with Cmd/Ctrl or Shift. */
  marked: string[];
  anchorId: string | null;
  /** The playlist, folder or header being renamed in place. */
  renaming: string | null;
  /**
   * Where a playlist is renamed (Session 26a): on its row in the list, or the open playlist's title in the
   * centre. Only one name field opens.
   */
  renameIn: 'tree' | 'centre';
  /** Playlists or folders waiting for the operator to confirm removing them (`name` for one, else how many). */
  confirmRemove: {
    ids: string[];
    name: string;
    folder: boolean;
    template: boolean;
    inside: number;
    folders?: number;
  } | null;
  /** The last problem, until the next change works. */
  problem: string | null;
  /**
   * Reads that failed (Session 39), until one works: the playlists (their list and the templates), or the
   * open playlist's items (its id). The window says so with Try again, never "No playlists" when there are
   * some; what was read before stays shown.
   */
  unread: { playlists: boolean; itemsOf: string | null };
  /** The playlist being saved as a template (its dialog is open). */
  savingTemplate: string | null;
  /** The Add a slot dialog is open. */
  addingSlot: boolean;
  /** The slot (or import placeholder) being filled: its dialog is open. */
  filling: Extract<PlaylistItemInfo, { kind: 'placeholder' }> | null;
  /** The slot being renamed or given another category: its dialog is open. */
  editingSlot: Extract<PlaylistItemInfo, { kind: 'placeholder' }> | null;
  /** The item whose timer cues are being set: its dialog is open. */
  cuesFor: Extract<PlaylistItemInfo, { kind: 'presentation' | 'media' | 'shastra' }> | null;
}

export const usePlaylists = create<PlaylistView>(() => ({
  view: 'playlists',
  tree: [],
  templates: [],
  closed: [],
  selectedNodeId: null,
  markedNodes: [],
  nodeAnchor: null,
  openId: null,
  items: [],
  folder: '',
  marked: [],
  anchorId: null,
  renaming: null,
  renameIn: 'tree',
  confirmRemove: null,
  problem: null,
  unread: { playlists: false, itemsOf: null },
  savingTemplate: null,
  addingSlot: false,
  filling: null,
  editingSlot: null,
  cuesFor: null,
}));

/** A playlist, folder or template by its id. */
export function nodeOf(id: string | null): PlaylistNode | undefined {
  if (id === null) return undefined;
  const { tree, templates } = usePlaylists.getState();
  return tree.find((n) => n.id === id) ?? templates.find((n) => n.id === id);
}

/** Whether the open playlist is a template (its items are never shown on the screens from here). */
export const templateOpen = (s: PlaylistView): boolean => s.templates.some((t) => t.id === s.openId);

const api = () => window.drashti.playlists;

/** Show a failed change's message; true when it worked. */
function settled(result: PlaylistResult): result is { ok: true; ids: string[] } {
  usePlaylists.setState({ problem: result.ok ? null : result.message });
  return result.ok;
}

export async function loadTree(): Promise<void> {
  let read: [PlaylistNode[], PlaylistNode[]];
  try {
    read = await Promise.all([api().tree(), api().templates()]);
  } catch {
    // Said in the window with Try again (Session 39); the main process's log says why.
    usePlaylists.setState((s) => ({ unread: { ...s.unread, playlists: true } }));
    return;
  }
  const [tree, templates] = read;
  const ids = new Set([...tree, ...templates].map((n) => n.id));
  const { openId, selectedNodeId } = usePlaylists.getState();
  usePlaylists.setState((s) => ({
    tree,
    templates,
    openId: openId && ids.has(openId) ? openId : null,
    selectedNodeId: selectedNodeId && ids.has(selectedNodeId) ? selectedNodeId : null,
    unread: { ...s.unread, playlists: false },
  }));
}

export async function loadItems(): Promise<void> {
  const { openId } = usePlaylists.getState();
  if (!openId) {
    usePlaylists.setState((s) => ({ items: [], marked: [], unread: { ...s.unread, itemsOf: null } }));
    return;
  }
  let items: PlaylistItemInfo[];
  try {
    items = await api().items(openId);
  } catch {
    if (usePlaylists.getState().openId === openId)
      usePlaylists.setState((s) => ({ unread: { ...s.unread, itemsOf: openId } }));
    return;
  }
  // Ignore a slow answer for a playlist that is no longer open.
  if (usePlaylists.getState().openId !== openId) return;
  const ids = new Set(items.map((i) => i.id));
  usePlaylists.setState((s) => ({
    items,
    marked: s.marked.filter((id) => ids.has(id)),
    anchorId: s.anchorId && ids.has(s.anchorId) ? s.anchorId : null,
    unread: { ...s.unread, itemsOf: null },
  }));
  // The item in the slide grid follows its changes (a new order, a filled placeholder); gone, the grid lets it go.
  const shown = useLibrary.getState().item;
  if (shown?.playlistId === openId) {
    const now = items.find((i) => i.id === shown.id);
    const { playlistId: _, ...before } = shown;
    if (!now) leaveItem();
    else if (JSON.stringify(now) !== JSON.stringify(before)) await showItem({ ...now, playlistId: openId });
  }
}

async function reload(): Promise<void> {
  await loadTree();
  await loadItems();
}

/** Try again (Session 39): read the playlists, and the open one's items, once more. */
export function readPlaylistsAgain(): Promise<void> {
  return reload();
}

/** Whether a read the window needs failed: the playlists, or the open playlist's items. */
export const playlistsUnread = (s: PlaylistView): boolean =>
  s.unread.playlists || (s.openId !== null && s.unread.itemsOf === s.openId);

let watching = false;

/** Follow changes: to playlists, and to the library (a removed presentation shows in its items). */
export function watchPlaylists(): void {
  if (watching) return;
  watching = true;
  window.drashti.playlists.onChanged(() => {
    void reload();
    // A Repeat Slides playlist's steps in the grid follow its items and settings.
    const { selectedId, focusSlideId } = useLibrary.getState();
    if (selectedId !== null && isRepeatId(selectedId)) void showRepeatSteps(selectedId, focusSlideId);
  });
  useLibrary.subscribe((s, before) => {
    if (s.presentations !== before.presentations) void reload();
  });
  // Follow the show: when Next moves on to another item, the grid shows it, if it was showing the
  // item that was live. After a restart the playlist being played opens by itself.
  useEngine.subscribe((s, before) => {
    const now = s.state?.live.playlist ?? null;
    const was = before.state?.live.playlist ?? null;
    if (!now || (was?.playlistId === now.playlistId && was.itemId === now.itemId)) return;
    const shown = useLibrary.getState().item;
    const following =
      shown !== null && was !== null && shown.playlistId === was.playlistId && shown.id === was.itemId;
    const firstLook = before.state === null && shown === null;
    if (following || firstLook) void followItem(now);
    else if (was) followFolder(was, now);
  });
}

/** Whether the open playlist is shown a folder at a time (Session 44): made from a folder, with subfolders. */
export function showsFolders(s: Pick<PlaylistView, 'openId' | 'tree' | 'items'>): boolean {
  return (
    s.tree.find((n) => n.id === s.openId)?.fromFolder === true && s.items.some((i) => i.kind === 'header')
  );
}

/** The folder an item of the open playlist is in, when it is shown a folder at a time ('' otherwise). */
function folderOfItem(itemId: string): string {
  const state = usePlaylists.getState();
  if (!showsFolders(state)) return '';
  return playlistFolders(state.items).folderOf.get(itemId) ?? '';
}

/**
 * Next moved on within the open folder playlist while the middle showed the folder of the item that was
 * live (Session 44): the middle shows the folder of the one now live, so it follows the running order.
 */
function followFolder(was: PlaylistCursor, now: PlaylistCursor): void {
  const state = usePlaylists.getState();
  if (state.openId !== now.playlistId || was.playlistId !== now.playlistId || !showsFolders(state)) return;
  const view = playlistFolders(state.items);
  if (view.folderOf.get(was.itemId) !== state.folder) return;
  const next = view.folderOf.get(now.itemId);
  if (next !== undefined && next !== state.folder) usePlaylists.setState({ folder: next });
}

/** Show one of the open folder playlist's folders in the middle ('' for the top folder). */
export function openFolder(path: string): void {
  const state = usePlaylists.getState();
  if (!hasFolder(playlistFolders(state.items), path)) return;
  usePlaylists.setState({ folder: path, marked: [], anchorId: null });
}

/**
 * Where something added to the open playlist goes when nothing in it is chosen: at the end, or, shown a folder
 * at a time, at the end of the folder shown (after a header for it first, when it has no part of its own).
 */
export function addingAt(): { at: number | null; header: string | null } {
  const state = usePlaylists.getState();
  if (!showsFolders(state)) return { at: null, header: null };
  const end = folderEnd(state.items, playlistFolders(state.items), state.folder);
  return 'at' in end ? { at: end.at, header: null } : { at: end.headerAt, header: state.folder };
}

/** Open the playlist being played and show its live item. */
async function followItem(cursor: PlaylistCursor): Promise<void> {
  if (usePlaylists.getState().openId !== cursor.playlistId) await openPlaylist(cursor.playlistId);
  const item = usePlaylists.getState().items.find((i) => i.id === cursor.itemId);
  if (!item) return;
  // Shown a folder at a time (Session 44): the middle shows the folder the live item is in.
  usePlaylists.setState({ marked: [item.id], anchorId: item.id, folder: folderOfItem(item.id) });
  await showItem({ ...item, playlistId: cursor.playlistId });
}

/** A plain click on an item: mark it and show it in the slide grid. */
export async function pickItem(item: PlaylistItemInfo): Promise<void> {
  const state = usePlaylists.getState();
  const { openId } = state;
  if (!openId) return;
  clickItem(item.id, { toggle: false, range: false });
  // A template's items are never put up from here: it only makes playlists.
  if (templateOpen(state)) return;
  // A slot to fill: choose what goes there.
  if (item.kind === 'placeholder') {
    usePlaylists.setState({ filling: item });
    return;
  }
  // Repeat Slides (Session 26d): the grid shows all its steps, at this item's first.
  if (state.tree.find((n) => n.id === openId)?.kind === 'repeat') {
    await showRepeatSteps(
      repeatPresentationId(openId),
      `${item.id}/${item.kind === 'media' ? 'picture' : '0'}`,
    );
    return;
  }
  await showItem({ ...item, playlistId: openId });
}

export function setView(view: PlaylistView['view']): void {
  usePlaylists.setState({
    view,
    openId: null,
    items: [],
    folder: '',
    marked: [],
    anchorId: null,
    renaming: null,
  });
}

/** Save a playlist as a template, with these items as slots; then show the template. */
export async function saveAsTemplate(playlistId: string, name: string, slots: string[]): Promise<boolean> {
  const result = await api().saveAsTemplate(playlistId, { name, slots });
  if (!settled(result)) return false;
  usePlaylists.setState({ savingTemplate: null });
  const [id] = result.ids;
  setView('templates');
  await loadTree();
  if (id) await openPlaylist(id);
  return true;
}

/** A new playlist from a template, named for the operator to change straight away, and open. */
export async function newFromTemplate(templateId: string): Promise<void> {
  const template = nodeOf(templateId);
  if (!template) return;
  const day = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const name = `${template.name.replace(/^Example:\s*/u, '')} ${day}`;
  const parentId = usePlaylists.getState().view === 'playlists' ? newParent() : null;
  const result = await api().newFromTemplate(templateId, name, parentId);
  if (!settled(result)) return;
  const [id] = result.ids;
  setView('playlists');
  await loadTree();
  if (!id) return;
  await openPlaylist(id);
  usePlaylists.setState({ renaming: id });
}

/** A slot after the marked items (or at the end) of the open playlist or template. */
export async function addSlot(label: string, category: string | null): Promise<boolean> {
  const { openId, items, marked } = usePlaylists.getState();
  if (!openId) return false;
  const last = items.findLastIndex((i) => marked.includes(i.id));
  const result = await api().addSlot(openId, last >= 0 ? last + 1 : null, { label, category });
  if (!settled(result)) return false;
  usePlaylists.setState({ addingSlot: false });
  await reload();
  usePlaylists.setState({ marked: result.ids, anchorId: result.ids[0] ?? null });
  return true;
}

/** Rename the slot being edited, and give it a category (a Shastra passage, or none). */
export async function editSlot(label: string, category: string | null): Promise<void> {
  const slot = usePlaylists.getState().editingSlot;
  if (!slot) return;
  if (!settled(await api().editSlot(slot.id, { label, category }))) return;
  usePlaylists.setState({ editingSlot: null });
  await loadItems();
}

/** What the item being set up does to timers when it goes up. */
export async function setTimerCues(cues: TimerCue[]): Promise<void> {
  const item = usePlaylists.getState().cuesFor;
  if (!item) return;
  if (!settled(await api().setTimers(item.id, cues))) return;
  usePlaylists.setState({ cuesFor: null });
  await loadItems();
}

/** Fill the slot being filled with a presentation. */
export async function fillSlot(presentationId: string): Promise<void> {
  const slot = usePlaylists.getState().filling;
  if (!slot) return;
  usePlaylists.setState({ filling: null });
  await fillPlaceholder(slot.id, [presentationId]);
}

/** The order a presentation item plays in (its own arrangement, or the presentation's). */
export async function setItemOrder(itemId: string, order: ItemOrder): Promise<void> {
  if (settled(await api().setItemOrder(itemId, order))) await loadItems();
}

// ---- the tree ------------------------------------------------------------------

export async function openPlaylist(id: string): Promise<void> {
  // A folder playlist opens on its top folder (Session 44): clicking the playlist goes back to it.
  usePlaylists.setState({
    openId: id,
    selectedNodeId: id,
    items: [],
    folder: '',
    marked: [],
    anchorId: null,
  });
  // Opened on Main, it counts as this week's: output nodes copy its media ahead (Session 14).
  void api()
    .opened(id)
    .catch(() => undefined);
  await loadItems();
}

export function closePlaylist(): void {
  usePlaylists.setState({ openId: null, items: [], folder: '', marked: [], anchorId: null, renaming: null });
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
    renameIn: 'tree',
    closed: s.closed.filter((c) => c !== parentId),
  }));
}

export function startRenaming(id: string, where: 'tree' | 'centre' = 'tree'): void {
  usePlaylists.setState({ renaming: id, renameIn: where });
}

export function stopRenaming(): void {
  usePlaylists.setState({ renaming: null });
}

export async function renameNode(id: string, name: string): Promise<void> {
  stopRenaming();
  const node = nodeOf(id);
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
  const node = nodeOf(id);
  if (!node) return;
  usePlaylists.setState({
    confirmRemove: {
      ids: [id],
      name: node.name,
      folder: node.isFolder,
      template: node.template,
      inside: inside(tree, id).filter((n) => !n.isFolder).length,
    },
  });
}

/** A click on a playlist or folder with Cmd/Ctrl (one more) or Shift (a range of `order`, the rows shown). */
export function markNode(
  id: string,
  mods: { toggle: boolean; range: boolean },
  order: readonly string[],
): void {
  const { markedNodes, nodeAnchor } = usePlaylists.getState();
  if (mods.range && nodeAnchor !== null) {
    const from = order.indexOf(nodeAnchor);
    const to = order.indexOf(id);
    if (from >= 0 && to >= 0) {
      usePlaylists.setState({ markedNodes: order.slice(Math.min(from, to), Math.max(from, to) + 1) });
      return;
    }
  }
  const set = new Set(markedNodes);
  if (mods.toggle && set.has(id)) set.delete(id);
  else set.add(id);
  usePlaylists.setState({ markedNodes: [...set], nodeAnchor: id, selectedNodeId: id });
}

/**
 * Ask before removing many playlists and folders at once (Session 44), with what the folders hold; one in a
 * folder that goes too is taken with it.
 */
export function requestRemoveNodes(ids: readonly string[]): void {
  const { tree } = usePlaylists.getState();
  const chosen = new Set(ids);
  const within = (n: PlaylistNode): boolean => {
    for (let p = n.parentId; p !== null; p = tree.find((t) => t.id === p)?.parentId ?? null)
      if (chosen.has(p)) return true;
    return false;
  };
  const nodes = tree.filter((n) => chosen.has(n.id) && !within(n));
  if (nodes.length === 0) return;
  const [only] = nodes;
  if (nodes.length === 1 && only) {
    requestRemoveNode(only.id);
    return;
  }
  const folders = nodes.filter((n) => n.isFolder);
  usePlaylists.setState({
    confirmRemove: {
      ids: nodes.map((n) => n.id),
      name: '',
      folder: folders.length > 0,
      template: false,
      folders: folders.length,
      inside: folders.flatMap((f) => inside(tree, f.id)).filter((n) => !n.isFolder && !chosen.has(n.id))
        .length,
    },
  });
}

/** What a removal of these says: “Name”, "3 playlists", "2 folders", "2 playlists and a folder". */
export function removingWhat(pending: NonNullable<PlaylistView['confirmRemove']>): string {
  const count = pending.ids.length;
  if (count === 1)
    return `${pending.folder ? 'folder' : pending.template ? 'template' : 'playlist'} “${pending.name}”`;
  const folders = pending.folders ?? 0;
  const playlists = count - folders;
  const part = (n: number, one: string) => (n === 1 ? `a ${one}` : `${String(n)} ${one}s`);
  if (folders === 0) return `${String(count)} playlists`;
  if (playlists === 0) return `${String(count)} folders`;
  return `${playlists === 1 ? 'a playlist' : `${String(playlists)} playlists`} and ${part(folders, 'folder')}`;
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
  usePlaylists.setState({ markedNodes: [], nodeAnchor: null });
  pushRemoval({
    text: `Deleted ${removingWhat(pending)}`,
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

/** An item's name, as its row shows it. */
export function itemName(item: PlaylistItemInfo): string {
  return item.kind === 'presentation' ? (item.presentationName ?? item.label) : item.label;
}

/**
 * Library items into a playlist (dropped there, or Add to playlist) as one Undo step: Undo takes
 * them out again.
 */
export async function addFromLibrary(
  playlistId: string,
  at: number | null,
  items: NewItem[],
): Promise<string[]> {
  const ids = await addItems(playlistId, at, items);
  if (ids.length === 0) return ids;
  const names = usePlaylists
    .getState()
    .items.filter((i) => ids.includes(i.id))
    .map(itemName);
  pushRemoval({
    text: `Added ${describeSome(names, ids.length, 'item')} to “${nodeOf(playlistId)?.name ?? 'the playlist'}”`,
    restore: async () => {
      if (settled(await api().removeItems(ids))) await reload();
    },
  });
  return ids;
}

/**
 * Files from the Finder or Explorer dropped on a playlist (Session 26a): imported as files dropped
 * anywhere are (the same rules: Pro Mode, an admin's with roles on), then everything the import made
 * added before the item that was at `at` when they landed (at the end when none), in the order dropped.
 */
export async function importIntoPlaylist(
  playlistId: string,
  at: number | null,
  paths: string[],
  /** A header to put first (Session 44: a folder shown that has no part of its own yet). */
  header: string | null = null,
): Promise<void> {
  if (paths.length === 0) return;
  const before = () => {
    const { openId, items } = usePlaylists.getState();
    return openId === playlistId && at !== null ? (items[at]?.id ?? null) : null;
  };
  const beforeId = before();
  const result = await importPaths(paths);
  if (!result?.ok) return;
  const report = await window.drashti.library.getImportReport(result.run.id);
  const made = itemsMadeBy(report?.items ?? [], paths);
  if (made.length === 0) return;
  // The import may have taken a while: the place is found again by the item it went before.
  const { openId, items } = usePlaylists.getState();
  const index = openId === playlistId && beforeId !== null ? items.findIndex((i) => i.id === beforeId) : -1;
  await addFromLibrary(
    playlistId,
    index >= 0 ? index : null,
    header === null ? made : [{ kind: 'header', label: header }, ...made],
  );
}

/** Add to the open playlist, after its chosen item, or at the end when none is chosen (Add to playlist). */
export async function addToOpenPlaylist(items: NewItem[]): Promise<string[]> {
  const { openId, items: now, marked } = usePlaylists.getState();
  if (!openId) return [];
  const last = now.findLastIndex((i) => marked.includes(i.id));
  if (last >= 0) return addFromLibrary(openId, last + 1, items);
  // Nothing chosen: at the end, or at the end of the folder shown (Session 44).
  const { at, header } = addingAt();
  return addFromLibrary(openId, at, header === null ? items : [{ kind: 'header', label: header }, ...items]);
}

/**
 * Undo a move: every moved item first goes after the rest (which are then in their old order), then
 * each back to its old place, from the top down, and chosen again. Put back one at a time from where
 * they were dropped instead, an item still above its old place would push one already back down.
 */
async function putBack(playlistId: string, places: readonly { id: string; at: number }[]): Promise<void> {
  const ids = places.map((p) => p.id);
  const ok = settled(await api().moveItems(playlistId, ids, POSITION_MAX));
  if (ok)
    for (const { id, at } of [...places].sort((a, b) => a.at - b.at))
      if (!settled(await api().moveItems(playlistId, [id], at))) break;
  if (usePlaylists.getState().openId !== playlistId) await openPlaylist(playlistId);
  else await loadItems();
  usePlaylists.setState({ marked: places.map((p) => p.id), anchorId: places[0]?.id ?? null });
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

/** Move items (dragged) so they land before the item now at `at` (the end when it is past the last): one Undo step. */
export async function moveItems(ids: string[], at: number): Promise<void> {
  const { openId, items } = usePlaylists.getState();
  if (!openId || ids.length === 0) return;
  // The position among the items that stay.
  const to = items.slice(0, at).filter((i) => !ids.includes(i.id)).length;
  const places = items.flatMap((i, index) => (ids.includes(i.id) ? [{ id: i.id, at: index }] : []));
  if (!settled(await api().moveItems(openId, ids, to))) return;
  await loadItems();
  // Dropped where they were: nothing to undo.
  const order = (list: readonly PlaylistItemInfo[]) => list.map((i) => i.id).join(' ');
  if (order(usePlaylists.getState().items) === order(items)) return;
  pushRemoval({
    text: `Moved ${describeSome(
      items.filter((i) => ids.includes(i.id)).map(itemName),
      places.length,
      'item',
    )}`,
    restore: () => putBack(openId, places),
  });
}

/** Moves one at a time, each from the order the last one left (a held Alt+↑ never moves from an old order). */
let moving: Promise<unknown> = Promise.resolve();

/**
 * One item up or down a place (its Up and Down buttons, Alt+↑ ↓), chosen, as one Undo step that the
 * Undo bar says ("Moved “…” up"). False when it can go no further.
 */
export function moveItemBy(id: string, step: -1 | 1): Promise<boolean> {
  const run = moving.then(async () => {
    const { openId, items } = usePlaylists.getState();
    const from = items.findIndex((i) => i.id === id);
    const item = items[from];
    if (!openId || !item || from + step < 0 || from + step >= items.length) return false;
    if (!settled(await api().moveItems(openId, [id], from + step))) return false;
    await loadItems();
    usePlaylists.setState({ marked: [id], anchorId: id });
    pushRemoval({
      text: `Moved “${itemName(item)}” ${step < 0 ? 'up' : 'down'}`,
      restore: () => putBack(openId, [{ id, at: from }]),
    });
    return true;
  });
  moving = run.catch(() => undefined);
  return run;
}

/** + New › Repeat Slides (Session 26d): a Repeat Slides playlist where a new playlist would go, named at once. */
export async function createRepeatPlaylist(parentId: string | null = newParent()): Promise<void> {
  const result = await api().createRepeat(parentId);
  if (!settled(result)) return;
  const [id] = result.ids;
  await loadTree();
  if (!id) return;
  usePlaylists.setState((s) => ({
    selectedNodeId: id,
    renaming: id,
    renameIn: 'tree',
    closed: s.closed.filter((c) => c !== parentId),
  }));
  await openPlaylist(id);
}

/** A Repeat Slides playlist's settings changed (Pro Mode): from its next slide. */
export async function saveRepeatSettings(playlistId: string, settings: RepeatSettings): Promise<void> {
  if (settled(await api().setRepeat(playlistId, settings))) await loadTree();
}

/**
 * + New › Smart Playlist from a Folder… (Session 26c): an admin chooses the folder; the new playlist
 * opens, and fills itself as its files hold still.
 */
export async function createSmartPlaylist(): Promise<void> {
  const result = await api().createSmart();
  if (!settled(result)) return;
  const [id] = result.ids;
  // The dialog was closed.
  if (!id) return;
  await loadTree();
  await openPlaylist(id);
}

/** A smart playlist's missing items out (their files are gone from its folder); Undo brings them back. */
export async function removeMissingItems(playlistId: string): Promise<void> {
  const result = await api().removeMissing(playlistId);
  if (!settled(result) || result.ids.length === 0) return;
  const removed = result.ids;
  const playlist = nodeOf(playlistId)?.name ?? 'the playlist';
  pushRemoval({
    text: `Removed ${describeSome([], removed.length, 'missing item')} from “${playlist}”`,
    restore: async () => {
      await api().restoreItems(removed);
      if (usePlaylists.getState().openId !== playlistId) await openPlaylist(playlistId);
      await reload();
    },
  });
  await reload();
}

/** Remove the marked items; Undo brings them back where they were. */
export async function removeMarkedItems(): Promise<void> {
  const { openId } = usePlaylists.getState();
  const items = markedItems();
  if (!openId || items.length === 0) return;
  const result = await api().removeItems(items.map((i) => i.id));
  if (!settled(result) || result.ids.length === 0) return;
  const removed = result.ids;
  const playlist = nodeOf(openId)?.name ?? 'the playlist';
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
