import { create } from 'zustand';
import type { LinkKind, LinkResult, LinkView } from '../../../shared/links';
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
  /** Import runs from a link: where their files were saved. */
  savedFor: Record<string, string>;
}

export const useLinks = create<LinkStore>(() => ({
  view: null,
  open: false,
  kind: null,
  error: null,
  savedFor: {},
}));

let connected = false;
/** The run whose report was already opened (each opens once). */
let reported: string | null = null;

const somethingLive = () => useEngine.getState().state?.live.presentationId != null;

function heard(view: LinkView): void {
  useLinks.setState((s) => ({
    view,
    savedFor: view.runId && view.saved ? { ...s.savedFor, [view.runId]: view.saved.folder } : s.savedFor,
  }));
  // The import of what was saved ended: its report comes up, as an import's does (unless the show is on).
  if (view.phase === 'done' && view.runId && view.runId !== reported) {
    reported = view.runId;
    const runId = view.runId;
    void window.drashti.library.getImportReport(runId).then((report) => {
      if (report) useImports.setState({ finished: report });
      if (!somethingLive()) void openReport(runId);
    });
  }
}

export function connectLinks(): void {
  if (connected) return;
  connected = true;
  window.drashti.links.onChanged(heard);
  window.drashti.links.onOpen(openLinkDialog);
  void window.drashti.links.view().then((view) => {
    useLinks.setState({ view });
  });
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
  if (result.view) useLinks.setState({ view: result.view });
  useLinks.setState({ error: result.ok ? null : result.message });
  return result.ok;
}

export const lookAtLink = (kind: LinkKind, link: string) => act(() => window.drashti.links.look(kind, link));
export const pickSaveFolder = () => act(() => window.drashti.links.pickFolder());
export const startDownload = () => act(() => window.drashti.links.download());
export const stopDownload = () => act(() => window.drashti.links.stop());
export const anotherLink = () => act(() => window.drashti.links.reset());

/** A download, unpacking, conversion or import is going on (or waiting). */
export const linkBusy = (view: LinkView | null): boolean =>
  view !== null && ['waiting', 'downloading', 'unpacking', 'converting', 'importing'].includes(view.phase);

/** A folder's own name, the last part of its path (either system's). */
export const lastPart = (path: string): string => path.split(/[\\/]/u).filter(Boolean).pop() ?? path;
