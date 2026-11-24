import type { ImportProgress } from '../../../shared/import';

/** The status line's words for an import going or waiting (the operator window's bottom line). */
export function importProgressText(active: ImportProgress): string {
  return active.phase === 'queued'
    ? 'Waiting to import…'
    : active.phase === 'scanning'
      ? 'Looking for files…'
      : `Importing ${active.done.toLocaleString('en')} of ${active.total.toLocaleString('en')}${active.current ? ` · ${active.current}` : ''}`;
}
