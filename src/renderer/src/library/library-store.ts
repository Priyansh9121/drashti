import { create } from 'zustand';
import type { PresentationDoc, PresentationSummary } from '../../../shared/library';
import type { MediaSummary, PlaylistItemInfo } from '../../../shared/playlists';
import type { SearchHit, SearchResult } from '../../../shared/search';
import { isPassageId } from '../../../shared/shastra';

/** A playlist item, with the playlist it is in. */
export type ShownItem = PlaylistItemInfo & { playlistId: string };

interface LibraryView {
  presentations: PresentationSummary[];
  /** The presentation whose slides are shown. */
  selectedId: string | null;
  doc: PresentationDoc | null;
  /** Presentations marked for a list action such as Remove (the selected one and any added with Cmd/Ctrl or Shift). */
  marked: string[];
  /** Where a Shift-click range starts. */
  anchorId: string | null;
  /**
   * The playlist item the slide grid shows, when the operator picked one in
   * a playlist (its order can differ from the presentation's); null when
   * the grid shows the presentation picked in the library.
   */
  item: ShownItem | null;
  /** A slide to bring into view in the grid (a search found it). */
  focusSlideId: string | null;
  /**
   * Nothing is chosen on purpose (Session 26g: Skip for now on the first start): the middle shows its
   * three steps, and the first presentation is not chosen by itself until the operator picks one.
   */
  nothingChosen: boolean;
  /**
   * The presentation whose slides could not be read (Session 39), until it is chosen or read again: the grid
   * says so with Try again, never "Opening the presentation…" for good.
   */
  unreadId: string | null;
}

/** Which list the library shows: presentations, media, or Shastra texts. */
export type LibraryTab = 'presentations' | 'media' | 'shastra';
/**
 * The library's list, and whether its sheet is open (Session 44): the playlists have the whole left column,
 * and the library opens over it from the Library button, as a sheet that never holds the keyboard or the
 * show's keys, so its rows can be dragged into the open playlist.
 */
export const useLibraryTab = create<{ tab: LibraryTab; open: boolean }>(() => ({
  tab: 'presentations',
  open: false,
}));
/** Show one of the library's lists, opening the sheet if it is shut. */
export function setLibraryTab(tab: LibraryTab): void {
  useLibraryTab.setState({ tab, open: true });
}
export function openLibrary(): void {
  useLibraryTab.setState({ open: true });
}
export function closeLibrary(): void {
  useLibraryTab.setState({ open: false });
}

export const useLibrary = create<LibraryView>(() => ({
  presentations: [],
  selectedId: null,
  doc: null,
  marked: [],
  anchorId: null,
  item: null,
  focusSlideId: null,
  nothingChosen: false,
  unreadId: null,
}));

/**
 * A presentation's slides (Session 39): null when they could not be read, or it is not in the library;
 * the main process's log says why.
 */
async function readDoc(id: string): Promise<PresentationDoc | null> {
  try {
    return await window.drashti.library.getPresentation(id);
  } catch {
    return null;
  }
}

/** Set what was read for the presentation still chosen: its slides, or that they could not be read. */
function took(id: string, doc: PresentationDoc | null): void {
  if (useLibrary.getState().selectedId !== id) return;
  useLibrary.setState({ doc, unreadId: doc ? null : id });
}

/** Choose nothing (the first start's Skip for now): the middle's empty place leads, its steps first. */
export function chooseNothing(): void {
  useLibrary.setState({ selectedId: null, doc: null, marked: [], item: null, nothingChosen: true });
}

/** Show a playlist item in the slide grid: a presentation item's slides, or the item itself. */
export async function showItem(item: ShownItem): Promise<void> {
  useLibrary.setState({ item });
  if (item.kind === 'presentation' && item.presentationName !== null)
    await selectPresentation(item.presentationId);
  else if (item.kind === 'shastra' && !item.missing) await selectPresentation(item.passageId);
}

/**
 * A Repeat Slides playlist's steps in the slide grid (Session 26d), at the slide `focus` (an item's first):
 * a click on one puts it up and sets it going round from there. The library's own marks stay as they are.
 */
export async function showRepeatSteps(presentationId: string, focus: string | null): Promise<void> {
  useLibrary.setState({ item: null, selectedId: presentationId, focusSlideId: focus, nothingChosen: false });
  took(presentationId, await readDoc(presentationId));
}

/** Back to the library's own selection (the grid no longer shows a playlist item). */
export function leaveItem(): void {
  if (useLibrary.getState().item) useLibrary.setState({ item: null });
}

export async function selectPresentation(id: string): Promise<void> {
  useLibrary.setState((s) => ({
    nothingChosen: false,
    selectedId: id,
    marked: s.marked.includes(id) ? s.marked : [id],
    anchorId: s.anchorId ?? id,
    unreadId: s.unreadId === id ? id : null,
  }));
  // A slow answer for a presentation that is no longer selected is ignored.
  took(id, await readDoc(id));
}

/**
 * A click in the presentation list: a plain click selects one presentation;
 * Cmd/Ctrl adds or takes one away; Shift marks the range from the last click.
 */
export function clickPresentation(id: string, mods: { toggle: boolean; range: boolean }): void {
  leaveItem();
  useLibrary.setState({ focusSlideId: null });
  const { presentations, marked, anchorId } = useLibrary.getState();
  if (mods.range && anchorId) {
    const ids = presentations.map((p) => p.id);
    const from = ids.indexOf(anchorId);
    const to = ids.indexOf(id);
    if (from >= 0 && to >= 0) {
      useLibrary.setState({ marked: ids.slice(Math.min(from, to), Math.max(from, to) + 1) });
      void selectPresentation(id);
      return;
    }
  }
  if (mods.toggle) {
    const set = new Set(marked);
    if (set.has(id) && set.size > 1) set.delete(id);
    else set.add(id);
    useLibrary.setState({ marked: [...set], anchorId: id });
    const { selectedId } = useLibrary.getState();
    if (set.has(id)) void selectPresentation(id);
    else if (selectedId === id) void selectPresentation([...set][0] ?? id);
    return;
  }
  useLibrary.setState({ marked: [id], anchorId: id });
  void selectPresentation(id);
}

export async function loadLibrary(): Promise<void> {
  const presentations = await window.drashti.library.listPresentations();
  const ids = new Set(presentations.map((p) => p.id));
  const { selectedId, marked, anchorId } = useLibrary.getState();
  useLibrary.setState({
    presentations,
    marked: marked.filter((id) => ids.has(id)),
    anchorId: anchorId && ids.has(anchorId) ? anchorId : null,
  });
  // A Shastra passage stays shown (it is not in the list).
  if (selectedId && (ids.has(selectedId) || isPassageId(selectedId))) return;
  // Nothing selected yet, or the selected presentation is gone (removed): select the first, unless
  // nothing is chosen on purpose.
  if (useLibrary.getState().nothingChosen && !selectedId) return;
  const first = presentations[0];
  if (first) await selectPresentation(first.id);
  else useLibrary.setState({ selectedId: null, doc: null, marked: [] });
}

// ---- search ---------------------------------------------------------------------

interface SearchView {
  query: string;
  result: SearchResult | null;
  /** Presentations search cannot read yet, once the operator asks to see them. */
  legacy: { id: string; name: string }[] | null;
}

export const useSearch = create<SearchView>(() => ({ query: '', result: null, legacy: null }));

let searchTimer: ReturnType<typeof setTimeout> | null = null;

async function runSearch(): Promise<void> {
  const { query } = useSearch.getState();
  if (query.trim() === '') {
    useSearch.setState({ result: null });
    return;
  }
  const result = await window.drashti.library.search(query);
  // Only the answer to what is in the box now.
  if (useSearch.getState().query === result.query) useSearch.setState({ result });
}

/** What the operator typed: results follow as they type (a short pause first, so a fast typist sends one query). */
export function setSearch(query: string): void {
  useSearch.setState({ query });
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void runSearch(), query.trim() === '' ? 0 : 60);
}

export function clearSearch(): void {
  setSearch('');
  useSearch.setState({ legacy: null });
}

export async function showLegacy(): Promise<void> {
  const legacy = await window.drashti.library.legacyPresentations();
  useSearch.setState({ legacy });
}

export function hideLegacy(): void {
  useSearch.setState({ legacy: null });
}

/** Open a search result: its presentation, with the slide that matched brought into view. */
export function openHit(hit: SearchHit): void {
  clickPresentation(hit.presentationId, { toggle: false, range: false });
  useLibrary.setState({ focusSlideId: hit.match.kind === 'text' ? hit.match.slideId : null });
}

// ---- media ----------------------------------------------------------------------

interface MediaView {
  media: MediaSummary[];
  /** Loaded once the operator first looks at the media list. */
  loaded: boolean;
  /** Media marked for dragging into a playlist. */
  marked: string[];
  anchorId: string | null;
  /** Media's "From the drop folder" filter (Session 28). */
  dropOnly: boolean;
}

export const useMedia = create<MediaView>(() => ({
  media: [],
  loaded: false,
  marked: [],
  anchorId: null,
  dropOnly: false,
}));

/** The media the list shows: all of it, or what came from the drop folder (while any did). */
export function shownMedia(s: Pick<MediaView, 'media' | 'dropOnly'>): MediaSummary[] {
  return s.dropOnly && s.media.some((m) => m.fromDrop) ? s.media.filter((m) => m.fromDrop) : s.media;
}

export function setDropOnly(on: boolean): void {
  useMedia.setState({ dropOnly: on });
}

export async function loadMedia(): Promise<void> {
  const media = await window.drashti.library.listMedia();
  const ids = new Set(media.map((m) => m.id));
  useMedia.setState((s) => ({ media, loaded: true, marked: s.marked.filter((id) => ids.has(id)) }));
}

/** A click in the media list, marking like the presentation list. */
export function clickMedia(id: string, mods: { toggle: boolean; range: boolean }): void {
  const { marked, anchorId } = useMedia.getState();
  if (mods.range && anchorId) {
    // Over what the list shows (a filter hides the rest).
    const ids = shownMedia(useMedia.getState()).map((m) => m.id);
    const from = ids.indexOf(anchorId);
    const to = ids.indexOf(id);
    if (from >= 0 && to >= 0) {
      useMedia.setState({ marked: ids.slice(Math.min(from, to), Math.max(from, to) + 1) });
      return;
    }
  }
  if (mods.toggle) {
    const set = new Set(marked);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    useMedia.setState({ marked: [...set], anchorId: id });
    return;
  }
  useMedia.setState({ marked: [id], anchorId: id });
}

let watching = false;

/** Reload the list (and the open presentation, which an import may have replaced) when the library changes. */
export function watchLibrary(): void {
  if (watching) return;
  watching = true;
  window.drashti.library.onChanged((what) => {
    // A Shastra text loaded again, removed, or given another theme: the passage shown is made again.
    if (what === 'shastra') {
      const { selectedId } = useLibrary.getState();
      if (selectedId && isPassageId(selectedId)) void selectPresentation(selectedId);
      return;
    }
    if (what !== 'presentations') return;
    void loadLibrary().then(async () => {
      const { selectedId } = useLibrary.getState();
      if (selectedId) await selectPresentation(selectedId);
    });
    if (useMedia.getState().loaded) void loadMedia();
    // New or changed presentations show up in the results too.
    if (useSearch.getState().query.trim() !== '') void runSearch();
  });
}
