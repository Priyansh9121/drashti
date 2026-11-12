import { create } from 'zustand';
import type { PresentationDoc } from '../../../../shared/library';
import type { MessageTemplate } from '../../../../shared/messages';
import type { RemoteLibraryPage, RemotePresentation } from '../../../../shared/network-api';
import type { RemoteSimple } from '../../../../shared/network-phone';
import type { ItemOrder, PlaylistItemInfo, PlaylistNode } from '../../../../shared/playlists';
import { ALL_ON, type ScreenSwitches } from '../../../../shared/screen-switches';
import type { SearchHit, SearchResult } from '../../../../shared/search';
import { useEngine } from '../../engine/engine-store';
import { api } from '../device';
import { oneAtATime } from '../one-at-a-time';
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
  /** The playlist the phone has open, which can differ from the one open on the computer. */
  playlistId: string | null;
  items: PlaylistItemInfo[] | null;
  viewing: Viewing | null;
  doc: PresentationDoc | null;
  templates: MessageTemplate[] | null;
  /** The loaded Shastra texts (a reference box shows when there are any). */
  shastra: { name: string; abbreviation: string; itemCount: number }[] | null;
  /**
   * The hall's group, whose live Look the picture follows, and how Drashti's computer writes the time
   * (Sessions 31–36, SLD-6), and which of Main's screens are on, Audience and Stage (Session 50: said, never
   * changed, here); null until read.
   */
  hall: {
    groupId: string | null;
    clock: { locale: string; timeZone: string };
    switches: ScreenSwitches;
    /** The stage screens' group, whose layout's timers the remote runs (Session 54); null for none. */
    stageGroupId: string | null;
    /**
     * Simple Mode on Drashti's computer: its open playlist and the words this phone shows once;
     * null in Pro Mode (or from a Drashti before Session 55, Part 9).
     */
    simple: RemoteSimple | null;
  } | null;
  /** The once-said words of Simple Mode put away (Part 9): until Simple Mode next comes on. */
  simpleSaid: boolean;
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
  shastra: null,
  hall: null,
  simpleSaid: false,
}));

/** The playlists, as Drashti's "changed" asks for them again: one read at a time (one-at-a-time.ts). */
export const loadPlaylists = oneAtATime(readPlaylists);

async function readPlaylists(): Promise<void> {
  const r = await api<{ playlists: PlaylistNode[] }>('/api/v1/playlists');
  if (!r.ok) return;
  const lists = r.playlists.filter((p) => !p.template);
  const { playlistId, hall } = useRemote.getState();
  const live = useEngine.getState().state?.live.playlist?.playlistId ?? null;
  const desktop = hall?.simple?.playlistId ?? null;
  const playableIds = new Set(lists.filter((p) => !p.isFolder).map((p) => p.id));
  // On entering Simple Mode, start where the computer is. Later reads keep the phone's own choice.
  const choices = preferDesktopPlaylist ? [desktop, playlistId, live] : [playlistId, desktop, live];
  const chosen =
    choices.find((id) => id !== null && playableIds.has(id)) ?? playableIds.values().next().value ?? null;
  useRemote.setState({ playlists: lists });
  await showPlaylist(chosen);
}

let preferDesktopPlaylist = false;
let itemsRead = 0;

export async function showPlaylist(playlistId: string | null): Promise<void> {
  preferDesktopPlaylist = false;
  if (playlistId === null) {
    useRemote.setState({ playlistId, items: [] });
    return;
  }
  if (useRemote.getState().playlistId !== playlistId) {
    useRemote.setState({ playlistId, items: null });
  }
  await refreshPlaylist(playlistId);
}

/** A row changed: read its playlist again if it is still open on the phone. */
export async function refreshPlaylist(playlistId: string): Promise<void> {
  if (useRemote.getState().playlistId !== playlistId) return;
  const read = ++itemsRead;
  const r = await api<{ items: PlaylistItemInfo[] }>(
    `/api/v1/playlists/${encodeURIComponent(playlistId)}/items`,
  );
  if (r.ok && read === itemsRead && useRemote.getState().playlistId === playlistId) {
    useRemote.setState({ items: r.items });
  }
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

async function loadShastra(): Promise<void> {
  const r = await api<{ texts: { name: string; abbreviation: string; itemCount: number }[] }>(
    '/api/v1/shastra',
  );
  if (r.ok) useRemote.setState({ shastra: r.texts });
}

/** Mode and screen changes can arrive together: never let an older hall answer win a race. */
const loadHall = oneAtATime(readHall);

async function readHall(): Promise<void> {
  const r = await api<{
    groupId: string | null;
    clock: { locale: string; timeZone: string };
    switches?: ScreenSwitches;
    stageGroupId?: string | null;
    simple?: RemoteSimple | null;
  }>('/api/v1/hall');
  if (!r.ok) return;
  const { hall, playlistId } = useRemote.getState();
  const simple = r.simple ?? null;
  const enteringSimple = simple !== null && (hall?.simple ?? null) === null;
  useRemote.setState({
    hall: {
      groupId: r.groupId,
      clock: r.clock,
      switches: r.switches ?? { ...ALL_ON },
      stageGroupId: r.stageGroupId ?? null,
      simple,
    },
    ...(enteringSimple ? { simpleSaid: false } : {}),
  });
  if (simple === null) preferDesktopPlaylist = false;
  if (simple?.playlistId && (playlistId === null || (enteringSimple && simple.playlistId !== playlistId))) {
    preferDesktopPlaylist = enteringSimple;
    void loadPlaylists();
  }
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
    void loadHall();
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
    if (what === 'screens' || what === 'mode') void loadHall();
    if (what === 'shastra') void loadShastra();
  });
}
