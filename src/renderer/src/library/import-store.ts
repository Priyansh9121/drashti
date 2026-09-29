import { create } from 'zustand';
import type {
  ConflictChoice,
  ImportOptions,
  ImportProgress,
  ImportReport,
  ImportResult,
  ImportRunSummary,
} from '../../../shared/import';
import { useEngine } from '../engine/engine-store';
import { loadLibrary, selectPresentation, useLibrary } from './library-store';
import { describeSome, pushRemoval } from './undo';

/*
 * Imports, their reports, and removing presentations with Undo, as the
 * operator window sees them.
 */

interface Removal {
  ids: string[];
  names: string[];
}

interface ImportView {
  /** Runs going or waiting, by run id, in the order they started. */
  runs: Record<string, ImportProgress>;
  /** The last run this window started, once it ended. */
  finished: ImportRunSummary | null;
  error: string | null;
  /** The report on screen, if any. */
  report: ImportReport | null;
  /** Presentations waiting for the operator to confirm removing them. */
  confirmRemove: (Removal & { live: boolean }) | null;
}

export const useImports = create<ImportView>(() => ({
  runs: {},
  finished: null,
  error: null,
  report: null,
  confirmRemove: null,
}));

let watching = false;

const withoutRun = (runs: Record<string, ImportProgress>, runId: string) =>
  Object.fromEntries(Object.entries(runs).filter(([id]) => id !== runId));

/** Follow import progress from the main process. */
export function watchImports(): void {
  if (watching) return;
  watching = true;
  window.drashti.library.onImportProgress((progress) => {
    useImports.setState((s) => ({
      runs:
        progress.phase === 'finished'
          ? withoutRun(s.runs, progress.runId)
          : { ...s.runs, [progress.runId]: progress },
    }));
  });
}

const somethingLive = () => useEngine.getState().state?.live.presentationId != null;

export async function openReport(runId: string): Promise<void> {
  const report = await window.drashti.library.getImportReport(runId);
  useImports.setState({ report });
}

export function closeReport(): void {
  useImports.setState({ report: null });
}

async function settle(run: Promise<ImportResult>): Promise<ImportResult> {
  useImports.setState({ error: null });
  const result = await run;
  if (!result.ok) {
    useImports.setState({ error: result.message });
    return result;
  }
  useImports.setState((s) => ({ finished: result.run, runs: withoutRun(s.runs, result.run.id) }));
  // The report comes up by itself, unless the show is on: a dialog would take the keyboard.
  if (!somethingLive()) await openReport(result.run.id);
  return result;
}

/** Import files and folders (dropped, or picked in a dialog). */
export function importPaths(paths: string[], options?: ImportOptions): Promise<ImportResult | null> {
  if (paths.length === 0) return Promise.resolve(null);
  return settle(window.drashti.library.importPaths(paths, options));
}

/** The Import button: a system dialog for files or a folder. */
export async function importWithDialog(kind: 'files' | 'folder'): Promise<void> {
  const paths = await window.drashti.library.pickImportPaths(kind);
  await importPaths(paths);
}

/**
 * The file to import for a report item: the file itself, or the bundle it was
 * in ("bundle.pro6x!/inner/Song.pro6" is imported by importing the bundle).
 */
export const fileToImport = (sourcePath: string): string => sourcePath.split('!/')[0] ?? sourcePath;

/** Answer "replace or keep both?" for changed files. */
export async function resolveConflicts(sourcePaths: string[], choice: ConflictChoice): Promise<void> {
  closeReport();
  const files = [...new Set(sourcePaths.map(fileToImport))];
  await importPaths(files, { decisions: Object.fromEntries(sourcePaths.map((p) => [p, choice])) });
}

/** Look for missing media in a folder the operator picks. */
export async function relinkMedia(mediaIds?: string[]): Promise<void> {
  closeReport();
  await settle(window.drashti.library.relinkMedia(mediaIds));
}

export async function cancelImport(runId: string): Promise<void> {
  await window.drashti.library.cancelImport(runId);
}

export function dismissFinished(): void {
  useImports.setState({ finished: null, error: null });
}

// ---- removing presentations -------------------------------------------------

/** Ask before removing the marked presentations (Delete in the list). */
export function requestRemoval(): void {
  const { marked, selectedId, presentations } = useLibrary.getState();
  const ids = marked.length > 0 ? marked : selectedId ? [selectedId] : [];
  if (ids.length === 0) return;
  const names = ids.map((id) => presentations.find((p) => p.id === id)?.name ?? '').filter((n) => n !== '');
  const liveId = useEngine.getState().state?.live.presentationId ?? null;
  useImports.setState({ confirmRemove: { ids, names, live: liveId !== null && ids.includes(liveId) } });
}

export function cancelRemoval(): void {
  useImports.setState({ confirmRemove: null });
}

export async function confirmRemoval(): Promise<void> {
  const pending = useImports.getState().confirmRemove;
  if (!pending) return;
  useImports.setState({ confirmRemove: null });
  const result = await window.drashti.library.removePresentations(pending.ids);
  if (result.ok && result.ids.length > 0) {
    const ids = result.ids;
    pushRemoval({
      text: `Removed ${describeSome(pending.names, ids.length, 'presentation')}`,
      restore: () => restorePresentations(ids),
    });
  }
  await loadLibrary();
}

/** Undo for a removal: bring the presentations back and select them. */
async function restorePresentations(ids: string[]): Promise<void> {
  const result = await window.drashti.library.restorePresentations(ids);
  await loadLibrary();
  const first = result.ok ? result.ids[0] : undefined;
  if (first) {
    useLibrary.setState({ marked: result.ok ? result.ids : [], anchorId: first });
    await selectPresentation(first);
  }
}
