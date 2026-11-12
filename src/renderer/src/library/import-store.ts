import { create } from 'zustand';
import type { ImportOptions, ImportProgress, ImportResult, ImportRunSummary } from '../../../shared/import';
import { itemsMadeBy } from '../../../shared/import-items';
import type { NewItem } from '../../../shared/playlists';
import type { UsedIn } from '../../../shared/media-removal';
import { useEngine } from '../engine/engine-store';
import { openImportDestination, usePlaylists } from '../playlists/playlist-store';
import { showImportFailures, showImportNotice } from './import-notices';
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
  /**
   * Presentations waiting for the operator to confirm removing them; `closes` when it was asked from the middle
   * (Session 50: Delete… in the menu of the presentation open there), which then shows nothing chosen;
   * `fromItem`, the playlist's card the middle showed it as (Session 51), for Undo to show again.
   */
  confirmRemove:
    | (Removal & {
        live: boolean;
        closes?: boolean;
        fromItem?: PresentationCard;
        /** The playlists that hold them (Session 55, Part 14): the question says which. */
        playlists?: UsedIn;
      })
    | null;
}

export const useImports = create<ImportView>(() => ({
  runs: {},
  finished: null,
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

export type ImportDestination = (items: NewItem[]) => Promise<void>;

function finishedRun(run: ImportRunSummary): void {
  useImports.setState((s) => ({ finished: run, runs: withoutRun(s.runs, run.id) }));
}

/** Import dropped or picked files and add their playlist items at the destination captured at the start. */
export function importPaths(
  paths: string[],
  options?: ImportOptions,
  destination: ImportDestination | null = openImportDestination(),
): Promise<ImportResult | null> {
  const delivered = new Set<string>();
  const placeFiles = async (run: ImportRunSummary, files: string[]) => {
    const report = await window.drashti.library.getImportReport(run.id).catch(() => null);
    if (!report) {
      showImportNotice('Drashti couldn’t read which files came in.', () => placeFiles(run, files));
      return;
    }
    if (destination) {
      const made = itemsMadeBy(
        report.items.filter((item) => !item.target || !delivered.has(item.target.id)),
        files,
      );
      if (made.length > 0) {
        const place = async () => {
          await destination(made);
          for (const item of made) {
            if (item.kind === 'presentation') delivered.add(item.presentationId);
            if (item.kind === 'media') delivered.add(item.mediaId);
          }
        };
        try {
          await place();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'The imported files couldn’t be added.';
          showImportNotice(message, place);
        }
      }
    }
    showImportFailures(report, importAgain, relinkMedia);
  };
  const importAgain = async (files: string[]): Promise<ImportResult | null> => {
    if (files.length === 0) return null;
    let result: ImportResult;
    try {
      result = await window.drashti.library.importPaths(files, options);
    } catch {
      const message = 'Drashti couldn’t import the selected files. Select them again to retry the import.';
      showImportNotice(message);
      return { ok: false, message };
    }
    if (!result.ok) {
      if (result.message !== 'Cancelled before it started.') showImportNotice(result.message);
      return result;
    }
    finishedRun(result.run);
    await placeFiles(result.run, files);
    return result;
  };
  return importAgain(paths);
}

/** The Import button: a system dialog for files or a folder. */
export async function importWithDialog(kind: 'files' | 'folder'): Promise<void> {
  const destination = openImportDestination();
  const paths = await window.drashti.library.pickImportPaths(kind);
  await importPaths(paths, undefined, destination);
}

/** Search a folder chosen from a missing-media notice or from Ready. */
export async function relinkMedia(mediaIds?: string[]): Promise<boolean> {
  const result = await window.drashti.library.relinkMedia(mediaIds).catch(() => ({
    ok: false as const,
    message: 'Drashti couldn’t look for the missing files. Choose Find… again.',
  }));
  if (!result.ok) {
    if (result.message !== 'No folder was chosen.') showImportNotice(result.message);
    return false;
  }
  finishedRun(result.run);
  const report = await window.drashti.library.getImportReport(result.run.id).catch(() => null);
  if (!report) return false;
  showImportFailures(report, undefined, relinkMedia);
  return true;
}

export async function cancelImport(runId: string): Promise<void> {
  await window.drashti.library.cancelImport(runId);
}

export function dismissFinished(): void {
  useImports.setState({ finished: null });
}

// ---- removing presentations -------------------------------------------------

/**
 * Ask before removing the marked presentations (Delete in the list), or `of` (a row's trash button or
 * menu: the marked ones when it is one of them, else that one).
 */
export function requestRemoval(of?: string): Promise<void> {
  const { marked, selectedId, presentations } = useLibrary.getState();
  const ids =
    of !== undefined && !marked.includes(of)
      ? [of]
      : marked.length > 0
        ? marked
        : selectedId
          ? [selectedId]
          : [];
  if (ids.length === 0) return Promise.resolve();
  const names = ids.map((id) => presentations.find((p) => p.id === id)?.name ?? '').filter((n) => n !== '');
  return askIfUsed({ ids, names, live: false });
}

/**
 * Delete asks first only when what it deletes is on the screens or in a playlist, and says which (Session 55, Part
 * 14, the one right-click menu); otherwise it deletes at once, and Undo brings it back.
 */
async function askIfUsed(pending: NonNullable<ImportView['confirmRemove']>): Promise<void> {
  const usage = await window.drashti.library.presentationUsage(pending.ids).catch(() => null);
  const liveId = useEngine.getState().state?.live.presentationId ?? null;
  const live = (usage?.live ?? false) || (liveId !== null && pending.ids.includes(liveId));
  const playlists = usage?.playlists ?? { names: [], count: 0 };
  useImports.setState({ confirmRemove: { ...pending, live, playlists } });
  // Used nowhere (or not known: asked, to be safe): deleted at once, with Undo.
  if (usage !== null && !live && playlists.count === 0) await confirmRemoval();
}

/**
 * Ask before deleting the presentation open in the middle (Session 50: Delete… in its header's menu): that one
 * alone, whatever else is marked in the library. The same question and the same Undo as the library's trash;
 * once it is deleted the middle shows nothing chosen, never the next presentation by itself.
 */
export function requestRemovalOfOpen(id: string, name: string): Promise<void> {
  // Open as a playlist's card (Session 51): that card is kept, for Undo.
  const { item } = useLibrary.getState();
  const fromItem = item?.kind === 'presentation' && item.presentationId === id ? item : undefined;
  return askIfUsed({
    ids: [id],
    names: [name],
    live: false,
    closes: true,
    ...(fromItem ? { fromItem } : {}),
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
