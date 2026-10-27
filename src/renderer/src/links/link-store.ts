import { create } from 'zustand';
import {
  chosenHeight,
  type LinkKind,
  type LinkResult,
  type LinkView,
  type YouTubeType,
} from '../../../shared/links';

/** Where an import run's files were saved from a link, and the videos imported as smaller copies. */
export interface SavedFrom {
  folder: string;
  /** Saved videos taller than the highest quality: the library has a copy `maxHeight` tall of each. */
  fitted: string[];
  maxHeight: number;
}
import { useEngine } from '../engine/engine-store';
import { itemsMadeBy } from '../../../shared/import-items';
import { openReport, useImports } from '../library/import-store';
import { useNotice } from '../operator/actions';
import type { AddTarget } from '../playlists/add-made';
import { nameAfter } from '../playlists/add-made';
import { loadTree, openPlaylist } from '../playlists/playlist-store';
import { chosenTarget, landInPlaylist } from './link-playlist';

/*
 * Import from a Link in the operator window (Session 25b): the dialog's
 * state as the main process tells it, whether the dialog is open, and the
 * import reports that came from a link (to say where the files were saved).
 */

interface LinkStore {
  view: LinkView | null;
  open: boolean;
  /** The kind chosen in the dialog before a link is looked at. */
  kind: LinkKind | null;
  /** What the main process last refused, in words. */
  error: string | null;
  /** Import runs from a link: where their files were saved, and which videos were made smaller first. */
  savedFor: Record<string, SavedFrom>;
  /** A YouTube video's choices before Download (Session 25c): the tick starts unticked each time. */
  choice: { type: YouTubeType; height: number | null; permission: boolean };
  /**
   * When it's imported, add it to (Session 26a): chosen before Download; null until the operator picks one,
   * which means the playlist a download went into last, else the open one, else a new one (Session 54).
   */
  addTo: AddTarget | null;
}

const NO_CHOICE = { type: 'mp4' as const, height: null, permission: false };

export const useLinks = create<LinkStore>(() => ({
  view: null,
  open: false,
  kind: null,
  error: null,
  savedFor: {},
  choice: NO_CHOICE,
  addTo: null,
}));

/** The playlist a download's import goes into, chosen as Download was pressed; done once its import ends. */
let pendingAdd: AddTarget | null = null;

/**
 * What a new playlist for a download is called to begin with: a video's title as it is ("Vol. 2" and "1/3" are
 * part of a title, never a file's extension or folder), else the file's name without its extension.
 */
export function newPlaylistName(view: LinkView | null): string {
  const look = view?.look;
  if (look?.shape === 'video') return look.name.trim();
  return nameAfter(look?.name ?? 'Download');
}

/** Where the dialog says it will add what is imported (Session 54: the playlist chosen last, offered first). */
export const addToNow = (s: { addTo: AddTarget | null; view: LinkView | null }): AddTarget =>
  chosenTarget(s.addTo, s.view?.lastPlaylist ?? null, newPlaylistName(s.view));

/** A new playlist with no name yet: the download waits until it has one (Session 54). */
export const unnamed = (target: AddTarget | null): boolean =>
  target?.kind === 'new' && target.name.trim() === '';

/**
 * The import of a download ended: what it made goes into the playlist chosen for it, which then opens with the
 * new item shown and is offered first next time (Session 54).
 */
async function addImported(runId: string): Promise<void> {
  const target = pendingAdd;
  pendingAdd = null;
  if (!target || target.kind === 'none') return;
  const report = await window.drashti.library.getImportReport(runId);
  if (!report) return;
  const name = await landInPlaylist(target, itemsMadeBy(report.items, report.paths));
  if (name) useNotice.setState({ text: `What the link brought in was added to “${name}”.` });
}

let connected = false;
/** The run whose report was already opened (each opens once). */
let reported: string | null = null;

const somethingLive = () => useEngine.getState().state?.live.presentationId != null;

/** The main process's view: another video looked at starts its choices afresh, the tick unticked. */
function takeView(view: LinkView): void {
  useLinks.setState((s) => ({ view, choice: view.link !== s.view?.link ? NO_CHOICE : s.choice }));
}

/** The folder playlists already opened (each opens once, as it is made). */
const openedPlaylists = new Set<string>();

function heard(view: LinkView): void {
  takeView(view);
  // A Dropbox folder's own playlist (Session 26c): opened as it is made.
  const made = view.playlist;
  if (made && !openedPlaylists.has(made.id)) {
    openedPlaylists.add(made.id);
    void loadTree().then(() => openPlaylist(made.id));
  }
  useLinks.setState((s) => ({
    savedFor:
      view.runId && view.saved
        ? {
            ...s.savedFor,
            [view.runId]: { folder: view.saved.folder, fitted: view.fitted, maxHeight: view.maxHeight },
          }
        : s.savedFor,
  }));
  // The import of what was saved ended: its report comes up, as an import's does (unless the show is on).
  // Never over the link dialog: while that is open, it offers the report itself (See the import report).
  if (view.phase === 'done' && view.runId && view.runId !== reported) {
    reported = view.runId;
    const runId = view.runId;
    void addImported(runId);
    void window.drashti.library.getImportReport(runId).then((report) => {
      if (report) useImports.setState({ finished: report });
      if (!somethingLive() && !useLinks.getState().open) void openReport(runId);
    });
  }
}

/** The import report of what a link saved: the link dialog closes first, so the report is never under it. */
export function seeLinkReport(runId: string): void {
  closeLinkDialog();
  void openReport(runId);
}

export function connectLinks(): void {
  if (connected) return;
  connected = true;
  window.drashti.links.onChanged(heard);
  window.drashti.links.onOpen(openLinkDialog);
  void window.drashti.links.view().then(takeView);
}

export function openLinkDialog(): void {
  connectLinks();
  useLinks.setState({ open: true });
}

export function closeLinkDialog(): void {
  useLinks.setState({ open: false, error: null });
}

export function chooseKind(kind: LinkKind): void {
  useLinks.setState({ kind, error: null });
}

/** Run a request; its view (when it has one) and refusal land in the store. */
async function act(run: () => Promise<LinkResult>): Promise<boolean> {
  const result = await run();
  if (result.view) takeView(result.view);
  useLinks.setState({ error: result.ok ? null : result.message });
  return result.ok;
}

export const lookAtLink = (kind: LinkKind, link: string) => act(() => window.drashti.links.look(kind, link));
export const pickSaveFolder = () => act(() => window.drashti.links.pickFolder());
/** Download: a YouTube video with its choices (the tick is needed again for the next one). */
export async function startDownload(): Promise<boolean> {
  const { view, choice } = useLinks.getState();
  const video = view?.look?.video;
  // The height the dialog shows as chosen (the tallest allowed, until one is picked).
  const asked = video ? { ...choice, height: chosenHeight(video, view.maxHeight, choice.height) } : null;
  // A folder makes a playlist of its own (Session 26c): nothing else to add it to.
  const target = view?.look?.shape === 'folder' ? null : addToNow(useLinks.getState());
  // A new playlist is named before the download starts (Session 54): Download stays off until it is.
  if (unnamed(target)) return false;
  const ok = await act(() => window.drashti.links.download(asked));
  if (ok) pendingAdd = target;
  const youtube = video !== undefined;
  if (ok && youtube) useLinks.setState((s) => ({ choice: { ...s.choice, permission: false } }));
  return ok;
}

/** Change a YouTube video's choices before Download. */
export function choose(change: Partial<LinkStore['choice']>): void {
  useLinks.setState((s) => ({ choice: { ...s.choice, ...change }, error: null }));
}
export const stopDownload = () => act(() => window.drashti.links.stop());
/** Add the PDFs and pictures (Session 26c): a folder's waiting files, into its playlist. */
export const addWaitingFiles = () => act(() => window.drashti.links.addWaiting());
export const anotherLink = () => {
  // A playlist chosen stays chosen (a playlist's own From a Link… chooses it, then this is pressed on the last
  // download's result); no playlist, or a new one (the last download made it), starts afresh (Session 54).
  useLinks.setState((s) => ({ addTo: s.addTo?.kind === 'playlist' ? s.addTo : null }));
  return act(() => window.drashti.links.reset());
};

/** Where what the link brings in goes, once imported (before Download). */
export function chooseAddTo(target: AddTarget): void {
  useLinks.setState({ addTo: target });
}
/** The highest video quality, for YouTube and Dropbox (Session 25c). */
export const setMaxHeight = (height: number) => act(() => window.drashti.links.setMaxHeight(height));

/** A download, unpacking, conversion or import is going on (or waiting). */
export const linkBusy = (view: LinkView | null): boolean =>
  view !== null && ['waiting', 'downloading', 'unpacking', 'converting', 'importing'].includes(view.phase);

/** A folder's own name, the last part of its path (either system's). */
export const lastPart = (path: string): string => path.split(/[\\/]/u).filter(Boolean).pop() ?? path;
