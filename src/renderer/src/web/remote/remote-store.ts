import { create } from 'zustand';
import type { PresentationDoc } from '../../../../shared/library';
import type { RemoteLibraryPage, RemotePresentation } from '../../../../shared/network-api';
import type { RemoteSimple } from '../../../../shared/network-phone';
import type { ItemOrder, PlaylistItemInfo, PlaylistNode } from '../../../../shared/playlists';
import { ALL_ON, type ScreenSwitches } from '../../../../shared/screen-switches';
import type { SearchHit, SearchResult } from '../../../../shared/search';
import { useEngine } from '../../engine/engine-store';
import { api } from '../device';
import { oneAtATime } from '../one-at-a-time';
import { onListsChanged, onOnline } from '../feed';
import { forgetDocs, gateDocs } from './phone-tools-store';

/*
 * What the remote shows besides the engine's state: the playlists, a
 * playlist's items, the presentation whose slides are shown, and the hall.
 * Read over the network as the operator window reads them, and again when
 * Drashti says they changed. The slides shown follow the live item.
 * Since alpha.23 (QA23-PHONE-1) a phone in Simple Mode reads none of the
 * playlists or presentations (it shows what is live, the Sabha flow and the
 * chat: phone-mode.ts), and no phone reads the messages or the books.
 */

/** The phone's tabs (phone-mode.ts says which a mode has); Chat (alpha.23, QA23-CHAT-1) is the day's group chat. */
export type RemoteTab = 'show' | 'playlist' | 'chat';

/** What a tablet's side shows beside the show: the playlist (Pro Mode), or the chat. */
export type RemoteSide = 'playlist' | 'chat';

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
  hall: null,
  simpleSaid: false,
}));

/** The playlists, as Drashti's "changed" asks for them again: one read at a time (one-at-a-time.ts). */
export const loadPlaylists = oneAtATime(readPlaylists);

/** Simple Mode on the computer, as the hall last said: a phone there reads no playlist or presentation. */
const inSimpleMode = (): boolean => (useRemote.getState().hall?.simple ?? null) !== null;

/**
 * Whether this connection's hall has answered (a23-review-phoneui MUST-1): on a page's first connection, and after each
 * drop (a locked phone), the feed's snapshot comes before it, and Simple Mode may have come on meanwhile. No playlist or
 * presentation is read until then.
 */
let hallKnown = false;

/** A playlist or a presentation may be read now: this connection's hall heard, and it says Pro Mode. */
const mayRead = (): boolean => hallKnown && !inSimpleMode();

/**
 * Whether this connection's own reads are done (a24-review-phonefix S2): once its hall is heard, the rows' decks let
 * go, the playlists and the slides shown read afresh (a23-review-phoneui MUST-3). When the connection's first hall read
 * fails, the first hall heard after it does them, whoever reads it (a library refresh, a mode or screens change), so a
 * deck changed while the phone was away is never kept.
 */
let caughtUp = true;

/** This connection's own reads, once its hall is heard (onOnline's, or the first hall heard after that failed). */
function catchUp(): void {
  if (caughtUp || !hallKnown) return;
  caughtUp = true;
  forgetDocs();
  void loadPlaylists();
  const v = useRemote.getState().viewing;
  if (v) void loadDoc(v.presentationId);
}

async function readPlaylists(): Promise<void> {
  if (!mayRead()) return;
  const r = await api<{ playlists: PlaylistNode[] }>('/api/v1/playlists');
  if (!r.ok) return;
  const lists = r.playlists.filter((p) => !p.template);
  const { playlistId } = useRemote.getState();
  const live = useEngine.getState().state?.live.playlist?.playlistId ?? null;
  const playableIds = new Set(lists.filter((p) => !p.isFolder).map((p) => p.id));
  // The phone's own choice, else the live playlist, else the first.
  const chosen =
    [playlistId, live].find((id) => id !== null && playableIds.has(id)) ??
    playableIds.values().next().value ??
    null;
  useRemote.setState({ playlists: lists });
  await showPlaylist(chosen);
}

let itemsRead = 0;

export async function showPlaylist(playlistId: string | null): Promise<void> {
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
    catchUpLive();
  }
}

/**
 * The live row, once the phone has its playlist's rows (CI run 45610620870): a phone that connects while a row is live
 * showed its slides before it had the rows, so none was marked live and a slide tapped went up from no row.
 */
function catchUpLive(): void {
  const { viewing } = useRemote.getState();
  const v = liveViewing();
  if (v?.item && viewing?.presentationId === v.presentationId && viewing.item === null) view(v, false);
}

async function loadDoc(presentationId: string): Promise<void> {
  if (!mayRead()) return;
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
  const { hall, viewing } = useRemote.getState();
  const simple = r.simple ?? null;
  const enteringSimple = simple !== null && (hall?.simple ?? null) === null;
  const leavingSimple = simple === null && (hall?.simple ?? null) !== null;
  // A connection's first hall: its own chain reads what Pro Mode shows (startRemote's onOnline).
  const known = hallKnown;
  hallKnown = true;
  useRemote.setState({
    hall: {
      groupId: r.groupId,
      clock: r.clock,
      switches: r.switches ?? { ...ALL_ON },
      stageGroupId: r.stageGroupId ?? null,
      simple,
    },
    // Entering Simple Mode lets go of what Pro Mode read (a23-review-phoneui S4): leaving it, they are read afresh,
    // never shown hours old meanwhile.
    ...(enteringSimple ? { simpleSaid: false, playlists: null, items: null, doc: null } : {}),
  });
  if (enteringSimple) forgetDocs();
  // Back in Pro Mode: the playlists and the slides shown, read again (none were read in Simple Mode).
  if (leavingSimple && known) {
    void loadPlaylists();
    if (viewing) void loadDoc(viewing.presentationId);
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

/**
 * The playlists and the library changed (Drashti's 'playlists' and 'presentations' hints): read again at most once each
 * LIST_REFRESH_GAP_MS, whatever the number of changes (CI Mac run 45653717757: an operator's quick edits, each with its
 * own hall, playlists, rows, slides and every deck row read again, used up the phone's allowance, so its own Next could
 * be refused). The first change is read at once, the rest of a run once more after the gap; each read is the hall
 * first, as a phone in Simple Mode reads no playlist or presentation.
 */
export const LIST_REFRESH_GAP_MS = 500;

/**
 * The library changes seen since the last refresh began: the presentations they name (QA24-PHONE-C), or 'any' when
 * one named none; null, no library change. Those of the rows' decks and the slides shown are read again too.
 */
let libraryChanged: Set<string> | 'any' | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let lastRefreshAt = Number.NEGATIVE_INFINITY;

const refreshLists = oneAtATime(async () => {
  let library = libraryChanged;
  libraryChanged = null;
  lastRefreshAt = Date.now();
  await loadHall();
  // Its hall not heard (the read failed): nothing let go or read, until the next change or connection.
  if (!hallKnown) return;
  // This connection's first hall heard here (its own first read failed): its reads too, every row let go (S2).
  if (!caughtUp) {
    caughtUp = true;
    library = 'any';
  }
  // The library changed: the rows' pages read again too (a23-review-phoneui MUST-3), only those it names when it
  // names them (QA24-PHONE-C: a kirtan's words edited reads no PowerPoint or PDF row again).
  if (library === 'any') forgetDocs();
  else if (library) forgetDocs([...library]);
  await loadPlaylists();
  const v = useRemote.getState().viewing;
  if (v && (library === 'any' || library?.has(v.presentationId))) await loadDoc(v.presentationId);
});

/** A change of the playlists, or of the library (`library`) naming the presentations it changed (`ids`, when it can). */
function listsChanged(library: boolean, ids?: readonly string[]): void {
  if (library) {
    if (ids === undefined || libraryChanged === 'any') libraryChanged = 'any';
    else {
      libraryChanged ??= new Set();
      for (const id of ids) libraryChanged.add(id);
    }
  }
  if (refreshTimer) return;
  refreshTimer = setTimeout(
    () => {
      refreshTimer = null;
      void refreshLists();
    },
    Math.max(0, lastRefreshAt + LIST_REFRESH_GAP_MS - Date.now()),
  );
}

let started = false;

export function startRemote(): void {
  if (started) return;
  started = true;
  followLive();
  // The Playlist's rows read their presentations only when a playlist may be read (a23-review-phoneui LOW-1).
  gateDocs(mayRead);
  onOnline(() => {
    // This connection's hall first (a23-review-phoneui MUST-1): in Simple Mode the phone reads no playlist or
    // presentation. Then what Pro Mode shows, read afresh: the playlists, the slides shown, the rows' pages (MUST-3).
    hallKnown = false;
    caughtUp = false;
    // Its hall not heard (the read failed): nothing let go or read until the next hall is heard (catchUp, S2).
    void loadHall().then(catchUp);
  });
  onListsChanged((what, ids) => {
    // The hall first (QA23-PHONE-1, CI run 45610620870): Drashti adopts Simple Mode's playlist, a 'playlists' change,
    // before it says the mode changed, and a phone in Simple Mode reads no playlist or presentation.
    if (what === 'playlists' || what === 'presentations') listsChanged(what === 'presentations', ids);
    // The first hall heard on a connection whose own read failed does that connection's reads too (S2).
    if (what === 'screens' || what === 'mode') void loadHall().then(catchUp);
  });
}
