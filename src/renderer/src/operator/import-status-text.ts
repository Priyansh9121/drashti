import type { ImportProgress } from '../../../shared/import';

/** The status line's words for an import going or waiting (the operator window's bottom line). */
export function importProgressText(active: ImportProgress): string {
  // Held for the screens' transitions (alpha.22, QA22-L8-1, the owner: "Keep wait, say why"): it says so.
  if (active.waitingFor === 'transitions')
    return `Waiting for the screens’ transitions to finish${active.current ? ` · ${active.current}` : ''}`;
  return active.phase === 'queued'
    ? 'Waiting to import…'
    : active.phase === 'scanning'
      ? 'Looking for files…'
      : `Importing ${active.done.toLocaleString('en')} of ${active.total.toLocaleString('en')}${active.current ? ` · ${active.current}` : ''}`;
}
