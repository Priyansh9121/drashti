import type { Page } from '@playwright/test';
import { basename } from 'node:path';
import type { ImportItemReport } from '../../src/shared/import';
import type { PageGlobals } from './helpers';

/** The recorded result for one of the unique fixture files dropped in the operator window. */
export function importItem(win: Page, path: string): Promise<ImportItemReport | null> {
  return win.evaluate(async (name) => {
    const d = (globalThis as PageGlobals).drashti;
    const leaf = (path: string) => path.split(/[\\/]/u).at(-1);
    const runs = await d.library.listImportRuns();
    const run = runs.find((run) => run.status === 'done' && run.paths.some((p) => leaf(p) === name));
    if (!run) return null;
    const details = await d.library.getImportReport(run.id);
    return details?.items.find((item) => leaf(item.sourcePath) === name) ?? null;
  }, basename(path));
}
