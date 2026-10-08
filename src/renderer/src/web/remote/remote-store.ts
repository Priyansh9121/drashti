import { create } from 'zustand';
import type { PresentationDoc } from '../../../../shared/library';
import type { MessageTemplate } from '../../../../shared/messages';
import type { RemoteLibraryPage, RemotePresentation } from '../../../../shared/network-api';
import type { ItemOrder, PlaylistItemInfo, PlaylistNode } from '../../../../shared/playlists';
import type { SearchHit, SearchResult } from '../../../../shared/search';
import { useEngine } from '../../engine/engine-store';
import { api } from '../device';
import { onListsChanged, onOnline } from '../feed';

/*
 * What the remote shows besides the engine's state: the playlists, a
 * playlist's items, the presentation whose slides are shown, the message
 * templates and whether a logo is marked. Read over the network as the
 * operator window reads them, and again when Drashti says they changed.
 * The slides shown follow the live item, until the operator picks another.
 */

export type RemoteTab = 'show' | 'playlist' | 'library' | 'more';

/** What a tablet's side shows beside the show: the playlist or the whole library (Session 18). */
export type RemoteSide = 'playlist' | 'library';

/** The library as a Remote reads it (Session 18): by name a page at a time, or searched. */
export interface RemoteLibrary {
  /** The presentations listed so far, by name, and how many there are. */
  list: RemotePresentation[] | null;
  total: number;
  /** What is searched for ('' for none), and what was found (null while it is asked). */
  query: string;
  hits: SearchHit[] | null;
  more: boolean;
}

/** The slides shown: a playlist item's (in its order) or the live presentation's. */
export interface Viewing {
  presentationId: string;
  /** The playlist item, so going live from it carries on through the playlist. */
  item: { playlistId: string; itemId: string; order: ItemOrder } | null;
}

interface RemoteView {
  tab: RemoteTab;
  side: RemoteSide;
  library: RemoteLibrary;
  /** A slide to bring into view in the slides shown (a search found its words), or null. */
  focusSlideId: string | null;
  /** The live slide's notes and the next one's, under the live picture (remembered on this device). */
  notesOpen: boolean;
  playlists: PlaylistNode[] | null;
  /** The playlist the Playlist tab shows (the live one, until another is picked). */
  playlistId: string | null;
  items: PlaylistItemInfo[] | null;
  viewing: Viewing | null;
  doc: PresentationDoc | null;
  templates: MessageTemplate[] | null;
  logo: { id: string; name: string } | null;
  /** The Looks, in order (which is live comes with the engine state). */
  looks: { id: string; name: string }[] | null;
  macros: { id: string; name: string; color: string }[] | null;
  /** The loaded Shastra texts (a reference box shows when there are any). */
  shastra: { name: string; abbreviation: string; itemCount: number }[] | null;
}

const NOTES_KEY = 'drashti.remote.notes';

/** Whether this device last had the notes open (the browser may refuse storage: then they start open). */
function notesWereOpen(): boolean {
  try {
    return localStorage.getItem(NOTES_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

export function setNotesOpen(open: boolean): void {
  useRemote.setState({ notesOpen: open });
  try {
    localStorage.setItem(NOTES_KEY, open ? 'shown' : 'hidden');
  } catch {
    // Kept for this visit only.
  }
}

export const useRemote = create<RemoteView>(() => ({
  tab: 'show',
  side: 'playlist',
  library: { list: null, total: 0, query: '', hits: null, more: false },
  focusSlideId: null,
  notesOpen: notesWereOpen(),
  playlists: null,
  playlistId: null,
  items: null,
  viewing: null,
  doc: null,
  templates: null,
  logo: null,
  looks: null,
  macros: null,
  shastra: null,
}));

export async function loadPlaylists(): Promise<void> {
  const r = await api<{ playlists: PlaylistNode[] }>('/api/v1/playlists');
  if (!r.ok) return;
  const lists = r.playlists.filter((p) => !p.isFolder && !p.template);
  useRemote.setState({ playlists: lists });
  const { playlistId } = useRemote.getState();
  const live = useEngine.getState().state?.live.playlist?.playlistId ?? null;
  const chosen =
    playlistId && lists.some((p) => p.id === playlistId) ? playlistId : (live ?? lists[0]?.id ?? null);
  await showPlaylist(chosen);
}

export async function showPlaylist(playlistId: string | null): Promise<void> {
  useRemote.setState({ playlistId, items: playlistId ? useRemote.getState().items : [] });
  if (!playlistId) return;
  const r = await api<{ items: PlaylistItemInfo[] }>(
    `/api/v1/playlists/${encodeURIComponent(playlistId)}/items`,
  );
  if (r.ok && useRemote.getState().playlistId === playlistId) useRemote.setState({ items: r.items });
}

async function loadDoc(presentationId: string): Promise<void> {
  const r = await api<{ presentation: PresentationDoc }>(
    `/api/v1/presentations/${encodeURIComponent(presentationId)}`,
  );
  if (r.ok && useRemote.getState().viewing?.presentationId === presentationId)
    useRemote.setState({ doc: r.presentation });
}

/** Show a playlist item's slides (it does not go live until a slide is tapped); on a phone, on the Show tab. */
export function view(viewing: Viewing, toShowTab = true): void {
  const before = useRemote.getState().viewing;
  useRemote.setState(toShowTab ? { viewing, tab: 'show' } : { viewing });
  if (before?.presentationId !== viewing.presentationId) {
    useRemote.setState({ doc: null });
    void loadDoc(viewing.presentationId);
  }
}

// ---- the library (Session 18) ---------------------------------------------------------------------

/** The library by name: the first page, or the next one after those listed. */
export async function loadLibrary(more = false): Promise<void> {
  const before = useRemote.getState().library;
  const offset = more ? (before.list?.length ?? 0) : 0;
  const r = await api<RemoteLibraryPage>(`/api/v1/presentations?offset=${String(offset)}`);
  if (!r.ok) return;
  const now = useRemote.getState().library;
  const list = more ? [...(now.list ?? []).slice(0, offset), ...r.presentations] : r.presentations;
  useRemote.setState({ library: { ...now, list, total: r.total } });
}

/** Search the library as the window does; an answer to an older query is let go. */
export async function searchLibrary(query: string): Promise<void> {
  const q = query.trim();
  const now = useRemote.getState().library;
  useRemote.setState({ library: { ...now, query: q, hits: q === '' ? null : now.hits, more: false } });
  if (q === '') return;
  const r = await api<SearchResult>(`/api/v1/search?q=${encodeURIComponent(q)}`);
  const latest = useRemote.getState().library;
  if (!r.ok || latest.query !== q) return;
  useRemote.setState({ library: { ...latest, hits: r.hits, more: r.more } });
}

/**
 * A presentation from the library: its slides shown (nothing goes up until one is tapped); on a phone,
 * on the Show tab. A slide the search found is brought into view.
 */
export function openPresentation(presentationId: string, slideId: string | null = null): void {
  useRemote.setState({ focusSlideId: slideId });
  view({ presentationId, item: null });
}

async function loadTemplates(): Promise<void> {
  const r = await api<{ messages: MessageTemplate[] }>('/api/v1/messages');
  if (r.ok) useRemote.setState({ templates: r.messages });
}

async function loadMacros(): Promise<void> {
  const r = await api<{ macros: { id: string; name: string; color: string }[] }>('/api/v1/macros');
  if (r.ok) useRemote.setState({ macros: r.macros });
}

async function loadShastra(): Promise<void> {
  const r = await api<{ texts: { name: string; abbreviation: string; itemCount: number }[] }>(
    '/api/v1/shastra',
  );
  if (r.ok) useRemote.setState({ shastra: r.texts });
}

async function loadLooks(): Promise<void> {
  const r = await api<{ looks: { id: string; name: string }[] }>('/api/v1/looks');
  if (r.ok) useRemote.setState({ looks: r.looks });
}

async function loadLogo(): Promise<void> {
  const r = await api<{ logo: { id: string; name: string } | null }>('/api/v1/logo');
  if (r.ok) useRemote.setState({ logo: r.logo });
}

/** What is live, as the slides to show: the live presentation, with its playlist item when it has one. */
function liveViewing(): Viewing | null {
  const live = useEngine.getState().state?.live;
  if (!live?.presentationId) return null;
  const item = live.playlist
    ? useRemote
        .getState()
        .items?.find(
          (i) => i.id === live.playlist?.itemId && (i.kind === 'presentation' || i.kind === 'shastra'),
        )
    : undefined;
  return {
    presentationId: live.presentationId,
    item:
      live.playlist && item?.kind === 'presentation'
        ? { playlistId: live.playlist.playlistId, itemId: item.id, order: item.order }
        : live.playlist && item?.kind === 'shastra'
          ? { playlistId: live.playlist.playlistId, itemId: item.id, order: { mode: 'all' } }
          : null,
  };
}

/** Back to the slides on the screens, from a presentation opened from the library (Session 18). */
export function viewLive(): void {
  const v = liveViewing();
  if (v) {
    useRemote.setState({ focusSlideId: null });
    view(v, false);
  }
}

/** The slides shown follow what goes live: a new live item, or the live presentation. */
function followLive(): void {
  let last = '';
  useEngine.subscribe((s) => {
    const live = s.state?.live;
    if (!live?.presentationId) return;
    const key = `${live.presentationId}|${live.playlist?.itemId ?? ''}`;
    if (key === last) return;
    last = key;
    const v = liveViewing();
    // Following what went live leaves the tab as it is (timers stay in view while Next goes on).
    if (v) view(v, false);
  });
}

let started = false;

export function startRemote(): void {
  if (started) return;
  started = true;
  followLive();
  onOnline(() => {
    void loadPlaylists();
    void loadTemplates();
    void loadLogo();
    void loadLooks();
    void loadMacros();
    void loadShastra();
    const v = useRemote.getState().viewing;
    if (v) void loadDoc(v.presentationId);
  });
  onListsChanged((what) => {
    if (what === 'playlists' || what === 'presentations') void loadPlaylists();
    if (what === 'presentations') {
      const v = useRemote.getState().viewing;
      if (v) void loadDoc(v.presentationId);
      // The library changed: the list again if it was read, and the search again if one is up.
      const { library } = useRemote.getState();
      if (library.list) void loadLibrary();
      if (library.query !== '') void searchLibrary(library.query);
    }
    if (what === 'messages') void loadTemplates();
    if (what === 'props') void loadLogo();
    if (what === 'looks') void loadLooks();
    if (what === 'macros') void loadMacros();
    if (what === 'shastra') void loadShastra();
  });
}
