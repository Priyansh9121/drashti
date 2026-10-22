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
import { usePlaylists } from '../playlists/playlist-store';
import type { ShownItem } from './library-store';
import {
  chooseNothing,
  leaveItem,
  loadLibrary,
  selectPresentation,
  showItem,
  useLibrary,
} from './library-store';
import { describeSome, pushRemoval } from './undo';

/*
 * Imports, their reports, and removing presentations with Undo, as the
 * operator window sees them.
 */

interface Removal {
  ids: string[];
  names: string[];
}

/** A presentation's card in a playlist, as the middle shows it. */
type PresentationCard = ShownItem & { kind: 'presentation' };

interface ImportView {
  /** Runs going or waiting, by run id, in the order they started. */
  runs: Record<string, ImportProgress>;
  /** The last run this window started, once it ended. */
  finished: ImportRunSummary | null;
  error: string | null;
  /** The report on screen, if any. */
  report: ImportReport | null;
  /**
   * Presentations waiting for the operator to confirm removing them; `closes` when it was asked from the middle
   * (Session 50: Delete… in the menu of the presentation open there), which then shows nothing chosen;
   * `fromItem`, the playlist's card the middle showed it as (Session 51), for Undo to show again.
   */
  confirmRemove: (Removal & { live: boolean; closes?: boolean; fromItem?: PresentationCard }) | null;
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

async function settle(run: Promise<ImportResult>, report = true): Promise<ImportResult> {
  useImports.setState({ error: null });
  const result = await run;
  if (!result.ok) {
    useImports.setState({ error: result.message });
    return result;
  }
  useImports.setState((s) => ({ finished: result.run, runs: withoutRun(s.runs, result.run.id) }));
  // The report comes up by itself, unless the show is on (a dialog would take the keyboard) or the import was
  // for Audio (Session 44: the result line still offers it).
  if (report && !somethingLive()) await openReport(result.run.id);
  return result;
}

/** Import files and folders (dropped, or picked in a dialog); `report: false` keeps its report from opening by itself. */
export function importPaths(
  paths: string[],
  options?: ImportOptions,
  { report = true }: { report?: boolean } = {},
): Promise<ImportResult | null> {
  if (paths.length === 0) return Promise.resolve(null);
  return settle(window.drashti.library.importPaths(paths, options), report);
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

/**
 * Ask before removing the marked presentations (Delete in the list), or `of` (a row's trash button or
 * menu: the marked ones when it is one of them, else that one).
 */
export function requestRemoval(of?: string): void {
  const { marked, selectedId, presentations } = useLibrary.getState();
  const ids =
    of !== undefined && !marked.includes(of)
      ? [of]
      : marked.length > 0
        ? marked
        : selectedId
          ? [selectedId]
          : [];
  if (ids.length === 0) return;
  const names = ids.map((id) => presentations.find((p) => p.id === id)?.name ?? '').filter((n) => n !== '');
  const liveId = useEngine.getState().state?.live.presentationId ?? null;
  useImports.setState({ confirmRemove: { ids, names, live: liveId !== null && ids.includes(liveId) } });
}

/**
 * Ask before deleting the presentation open in the middle (Session 50: Delete… in its header's menu): that one
 * alone, whatever else is marked in the library. The same question and the same Undo as the library's trash;
 * once it is deleted the middle shows nothing chosen, never the next presentation by itself.
 */
export function requestRemovalOfOpen(id: string, name: string): void {
  const liveId = useEngine.getState().state?.live.presentationId ?? null;
  // Open as a playlist's card (Session 51): that card is kept, for Undo.
  const { item } = useLibrary.getState();
  const fromItem = item?.kind === 'presentation' && item.presentationId === id ? item : undefined;
  useImports.setState({
    confirmRemove: {
      ids: [id],
      names: [name],
      live: liveId === id,
      closes: true,
      ...(fromItem ? { fromItem } : {}),
    },
  });
}

/**
 * The middle's menu entry for it (Session 51): "Delete from the library…" while a playlist item is open there,
 * so it is never taken for the item's own trash, which only takes the item out of its playlist; "Delete…" for a
 * presentation opened from the library.
 */
export const deleteOpenLabel = (item: ShownItem | null): string =>
  item ? 'Delete from the library…' : 'Delete…';

/**
 * The question's line on playlists (Session 51), the same from the library's trash and the middle's menu, and
 * true whether it is in a playlist or not: a deleted presentation's cards are not taken out (as deleted media's
 * are) but stay where they were, marked, and the show passes over them, until Undo brings it back.
 */
export const playlistCardsLine = (count: number): string =>
  count === 1
    ? 'Any playlist it is in keeps its card, marked Removed from the library, and Next goes past it.'
    : 'Any playlist they are in keeps their cards, marked Removed from the library, and Next goes past them.';

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
    const { fromItem } = pending;
    pushRemoval({
      text: `Deleted ${describeSome(pending.names, ids.length, 'presentation')}`,
      restore: () => restorePresentations(ids, fromItem),
    });
    // Deleted from the middle (Session 50): it shows nothing chosen, as before anything is picked.
    if (pending.closes && ids.includes(useLibrary.getState().selectedId ?? '')) chooseNothing();
  }
  await loadLibrary();
}

/** Is this card in the playlist open now (not closed, nor taken out of it, since)? */
function cardOpen(card: PresentationCard): boolean {
  const { openId, items } = usePlaylists.getState();
  return openId === card.playlistId && items.some((i) => i.id === card.id);
}

/**
 * Undo for a removal: bring the presentations back and select them. Deleted from a playlist's card (Session 51),
 * the middle shows that card again while its playlist is open with it, so a slide clicked there plays in the
 * playlist, as before; otherwise the presentation, as the library's trash leaves it.
 */
async function restorePresentations(ids: string[], fromItem?: PresentationCard): Promise<void> {
  const result = await window.drashti.library.restorePresentations(ids);
  await loadLibrary();
  const first = result.ok ? result.ids[0] : undefined;
  if (!first) return;
  if (fromItem && cardOpen(fromItem)) {
    await showItem(fromItem);
    return;
  }
  leaveItem();
  useLibrary.setState({ marked: result.ok ? result.ids : [], anchorId: first });
  await selectPresentation(first);
}
