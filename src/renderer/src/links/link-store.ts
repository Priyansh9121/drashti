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
import { openReport, useImports } from '../library/import-store';

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
}

const NO_CHOICE = { type: 'mp4' as const, height: null, permission: false };

export const useLinks = create<LinkStore>(() => ({
  view: null,
  open: false,
  kind: null,
  error: null,
  savedFor: {},
  choice: NO_CHOICE,
}));

let connected = false;
/** The run whose report was already opened (each opens once). */
let reported: string | null = null;

const somethingLive = () => useEngine.getState().state?.live.presentationId != null;

/** The main process's view: another video looked at starts its choices afresh, the tick unticked. */
function takeView(view: LinkView): void {
  useLinks.setState((s) => ({ view, choice: view.link !== s.view?.link ? NO_CHOICE : s.choice }));
}

function heard(view: LinkView): void {
  takeView(view);
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
  const ok = await act(() => window.drashti.links.download(asked));
  const youtube = video !== undefined;
  if (ok && youtube) useLinks.setState((s) => ({ choice: { ...s.choice, permission: false } }));
  return ok;
}

/** Change a YouTube video's choices before Download. */
export function choose(change: Partial<LinkStore['choice']>): void {
  useLinks.setState((s) => ({ choice: { ...s.choice, ...change }, error: null }));
}
export const stopDownload = () => act(() => window.drashti.links.stop());
export const anotherLink = () => act(() => window.drashti.links.reset());
/** The admin's highest video quality, for YouTube and Dropbox (Session 25c). */
export const setMaxHeight = (height: number) => act(() => window.drashti.links.setMaxHeight(height));

/** A download, unpacking, conversion or import is going on (or waiting). */
export const linkBusy = (view: LinkView | null): boolean =>
  view !== null && ['waiting', 'downloading', 'unpacking', 'converting', 'importing'].includes(view.phase);

/** A folder's own name, the last part of its path (either system's). */
export const lastPart = (path: string): string => path.split(/[\\/]/u).filter(Boolean).pop() ?? path;
