import { create } from 'zustand';
import type { PresentationDoc } from '../../../../shared/library';
import type { RemoteWallpapers } from '../../../../shared/network-phone';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import {
  movedPin,
  pinKey,
  QUICK_BAR_MAX,
  type QuickPin,
  withoutPin,
  withPin,
} from '../../../../shared/quick-bar';
import type { Icon } from '../../ui/icons';
import { api } from '../device';
import { onListsChanged, onOnline } from '../feed';
import { useTapNotice } from '../taps';
import { groupDocId } from '../../playlists/rows';

/*
 * What Parts 4–8 gave the operator window that a phone shows too (Session 55, Part 9): the presentations its playlist's
 * rows come from (read as the window reads them, again when Drashti says they changed), which of them are folded
 * (remembered on this phone), the wallpapers and the quick bar's pins (read over the network, again when they change),
 * and what is open over the remote now: a row's menu, Rename…'s question, the Picture editor, and the last Undo.
 */

/** An entry of a menu opened by a long press: its words, what it does, and how it shows. */
export interface MenuEntry {
  /** Its test id's end: remote-menu-<id>. */
  id: string;
  label: string;
  icon?: Icon;
  danger?: boolean;
  /** One of a few (When it ends): ticked or not. */
  pressed?: boolean;
  run: () => void;
}

/** What Rename… asks: the thing's kind in words, its name now, and how the new one is kept (null when it was). */
export interface Renaming {
  what: string;
  name: string;
  save: (name: string) => Promise<string | null>;
}

/** The last change with an Undo, said where it was made (the playlist's rows, or the wallpapers). */
export interface Undoable {
  where: 'rows' | 'wallpapers';
  text: string;
  undo: () => Promise<void>;
}

interface PhoneTools {
  /** Each presentation's slides by its id (null: it could not be read). */
  docs: Map<string, PresentationDoc | null>;
  /** The playlist items whose slides are folded under their names, remembered on this phone. */
  folded: string[];
  wallpapers: RemoteWallpapers | null;
  pins: QuickPin[];
  menu: { title: string; entries: MenuEntry[] } | null;
  renaming: Renaming | null;
  /** The Picture editor, open on a picture. */
  editing: { mediaId: string; name: string } | null;
  /** Remove from playlist, asked first while the row is on the screens (as the window asks). */
  removing: { playlistId: string; itemId: string; name: string } | null;
  undo: Undoable | null;
}

const FOLDED_KEY = 'drashti.remote.folded';
/** The most remembered: the oldest go first. */
const FOLDED_KEEP = 500;

function foldedBefore(): string[] {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]');
    return Array.isArray(kept) ? kept.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export const usePhoneTools = create<PhoneTools>(() => ({
  docs: new Map(),
  folded: foldedBefore(),
  wallpapers: null,
  pins: [],
  menu: null,
  renaming: null,
  editing: null,
  removing: null,
  undo: null,
}));

/** Fold an item's slides under its name, or open them again (remembered on this phone). */
export function toggleFolded(itemId: string): void {
  const { folded } = usePhoneTools.getState();
  const next = folded.includes(itemId)
    ? folded.filter((id) => id !== itemId)
    : [...folded, itemId].slice(-FOLDED_KEEP);
  usePhoneTools.setState({ folded: next });
  try {
    localStorage.setItem(FOLDED_KEY, JSON.stringify(next));
  } catch {
    // Kept for this visit only.
  }
}

// ---- the presentations the rows come from -------------------------------------------------------------------------

/** Read now, or being read. */
const asked = new Set<string>();

async function readDoc(id: string): Promise<void> {
  const r = await api<{ presentation: PresentationDoc }>(`/api/v1/presentations/${encodeURIComponent(id)}`);
  asked.delete(id);
  usePhoneTools.setState((s) => {
    const docs = new Map(s.docs);
    docs.set(id, r.ok ? r.presentation : null);
    return { docs };
  });
}

/** The presentations (and Shastra passages) a playlist's rows come from, each read once until they change. */
export function readDocsFor(items: readonly PlaylistItemInfo[] | null): void {
  if (!items) return;
  const { docs } = usePhoneTools.getState();
  for (const item of items) {
    if (item.kind !== 'presentation' && item.kind !== 'shastra') continue;
    if (item.kind === 'presentation' && item.presentationName === null) continue;
    const id = groupDocId(item);
    if (docs.has(id) || asked.has(id)) continue;
    asked.add(id);
    void readDoc(id);
  }
}

/** The library changed: every presentation is read again as its rows show. */
function forgetDocs(): void {
  asked.clear();
  usePhoneTools.setState({ docs: new Map() });
}

// ---- the wallpapers ---------------------------------------------------------------------------------------------

export async function loadWallpapers(): Promise<void> {
  const r = await api<RemoteWallpapers>('/api/v1/wallpapers');
  if (r.ok) usePhoneTools.setState({ wallpapers: { wallpapers: r.wallpapers, chosenId: r.chosenId } });
}

/** A change to the wallpapers, answered with them as they are after it; false with the problem said. */
async function changeWallpapers(path: string, body?: unknown): Promise<boolean> {
  const r = await api<RemoteWallpapers>(path, { method: 'POST', body: body ?? {} });
  if (!r.ok) {
    useTapNotice.setState({ text: r.message });
    return false;
  }
  usePhoneTools.setState({ wallpapers: { wallpapers: r.wallpapers, chosenId: r.chosenId } });
  return true;
}

/** One tap: chosen, or (the chosen one tapped) none. */
export function chooseWallpaper(id: string | null): Promise<boolean> {
  return changeWallpapers('/api/v1/wallpapers/choose', { wallpaperId: id });
}

export function renameWallpaper(id: string, name: string): Promise<boolean> {
  return changeWallpapers(`/api/v1/wallpapers/${encodeURIComponent(id)}/rename`, { name });
}

/** Deleted, with its Undo said under the wallpapers. */
export async function deleteWallpaper(id: string, name: string): Promise<void> {
  if (!(await changeWallpapers(`/api/v1/wallpapers/${encodeURIComponent(id)}/delete`))) return;
  usePhoneTools.setState({
    undo: {
      where: 'wallpapers',
      text: `Deleted the wallpaper “${name}”`,
      undo: async () => {
        await changeWallpapers(`/api/v1/wallpapers/${encodeURIComponent(id)}/restore`);
      },
    },
  });
}

// ---- the quick bar -----------------------------------------------------------------------------------------------

export async function loadPins(): Promise<void> {
  const r = await api<{ pins: QuickPin[] }>('/api/v1/quick-bar');
  if (r.ok) usePhoneTools.setState({ pins: r.pins });
}

async function savePins(pins: QuickPin[]): Promise<void> {
  const r = await api<{ pins: QuickPin[] }>('/api/v1/quick-bar', { method: 'POST', body: { pins } });
  if (r.ok) usePhoneTools.setState({ pins: r.pins });
  else useTapNotice.setState({ text: r.message });
}

export function isPinned(pin: QuickPin): boolean {
  const key = pinKey(pin);
  return usePhoneTools.getState().pins.some((p) => pinKey(p) === key);
}

/** Pinned at the end of the bar, as the window pins; a full bar says what to do. */
export async function pinIt(pin: QuickPin): Promise<void> {
  const { pins, full } = withPin(usePhoneTools.getState().pins, pin);
  if (full) {
    useTapNotice.setState({
      text: `The quick bar holds ${String(QUICK_BAR_MAX)}: take one off (a long press on it) to pin “${pin.label}”.`,
    });
    return;
  }
  await savePins(pins);
}

export async function unpin(key: string): Promise<void> {
  await savePins(withoutPin(usePhoneTools.getState().pins, key));
}

export async function movePin(key: string, by: -1 | 1): Promise<void> {
  await savePins(movedPin(usePhoneTools.getState().pins, key, by));
}

// ---- what is open over the remote --------------------------------------------------------------------------------

export function openMenu(title: string, entries: MenuEntry[]): void {
  if (entries.length > 0) usePhoneTools.setState({ menu: { title, entries } });
}

export function closeMenu(): void {
  usePhoneTools.setState({ menu: null });
}

export function askRename(renaming: Renaming): void {
  usePhoneTools.setState({ menu: null, renaming });
}

export function openEditor(mediaId: string, name: string): void {
  usePhoneTools.setState({ menu: null, editing: { mediaId, name } });
}

let started = false;

/** Read the wallpapers and the pins, and again when Drashti says they (or the library) changed. */
export function startPhoneTools(): void {
  if (started) return;
  started = true;
  onOnline(() => {
    void loadWallpapers();
    void loadPins();
    forgetDocs();
  });
  onListsChanged((what) => {
    if (what === 'wallpapers' || what === 'presentations') void loadWallpapers();
    if (what === 'quickBar') void loadPins();
    if (what === 'presentations') forgetDocs();
  });
}
