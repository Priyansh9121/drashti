import { create } from 'zustand';
import { formatBytes } from '../../../shared/format';
import type { ImportItemReport, ImportReport } from '../../../shared/import';

interface ImportNotice {
  id: number;
  text: string;
  retry?: () => Promise<unknown>;
  findMissing?: () => Promise<boolean>;
  /** What it is about, where only one notice may say it: a newer one takes an older one's place. */
  about?: string;
}

export const useImportNotices = create<{ notices: ImportNotice[] }>(() => ({ notices: [] }));

let nextId = 0;

function show(notices: Omit<ImportNotice, 'id'>[]): void {
  if (notices.length === 0) return;
  const said = new Set(notices.flatMap((notice) => (notice.about ? [notice.about] : [])));
  useImportNotices.setState((s) => ({
    notices: [
      ...notices.map((notice) => ({ ...notice, id: ++nextId })),
      ...s.notices.filter((notice) => notice.about === undefined || !said.has(notice.about)),
    ],
  }));
}

export function showImportNotice(text: string, retry?: () => Promise<unknown>): void {
  show([{ text, retry }]);
}

export function dismissImportNotice(id: number): void {
  useImportNotices.setState((s) => ({ notices: s.notices.filter((notice) => notice.id !== id) }));
}

export function dismissAllImportNotices(): void {
  useImportNotices.setState({ notices: [] });
}

export async function findImportMedia(notice: ImportNotice): Promise<void> {
  if (await notice.findMissing?.()) dismissImportNotice(notice.id);
}

export async function retryImportNotice(notice: ImportNotice): Promise<void> {
  if (!useImportNotices.getState().notices.some((item) => item.id === notice.id)) return;
  dismissImportNotice(notice.id);
  try {
    await notice.retry?.();
  } catch {
    showImportNotice('Drashti couldn’t try that again. Try again in a moment.', notice.retry);
  }
}

const missingParts = new Set([
  'bundle-entry',
  'deck-media-unmatched',
  'deck-motion-approximated',
  'deck-pictures',
  'deck-slides-pictures',
  'deck-sounds-left',
  'invalid-element',
  'missing-media',
  'missing-presentation',
  'pictures-animations',
  'pictures-failed-pages',
  'pictures-hidden',
  'pictures-notes-unmatched',
  'pictures-too-many',
  'unsupported-element',
]);

const nameOf = (item: ImportItemReport): string =>
  item.name ?? item.sourcePath.split(/[\\/]/u).at(-1) ?? 'File';

/**
 * Words typed in an old (legacy) Gujarati or Hindi font are kept as typed and drawn in that font, so they read right
 * only where it is installed (main/import/legacy-fonts.ts): a line for each font an import met, however many of its
 * presentations use it, and one in the stack for each font. Installing it is the only answer: no Try again, no Find….
 * Drashti draws in it once it is on the computer and Drashti has started again; importing again would change nothing.
 */
function oldFontNotices(report: ImportReport): Omit<ImportNotice, 'id'>[] {
  const fonts = new Map<string, { font: string; first: ImportItemReport; items: Set<string> }>();
  for (const item of report.items) {
    // A refused file did not come in: its fonts are named once it does.
    if (item.outcome === 'failed' || item.outcome === 'unsupported') continue;
    for (const issue of item.issues) {
      if (issue.code !== 'legacy-font' || issue.fix?.kind !== 'convert-font') continue;
      const font = issue.fix.font.trim();
      if (font === '') continue;
      // A font's name in any case is the same font, as the computer finds it.
      const key = font.toLowerCase();
      const use = fonts.get(key);
      if (use) use.items.add(item.id);
      else fonts.set(key, { font, first: item, items: new Set([item.id]) });
    }
  }
  const install = 'install it on this computer, then quit and start Drashti again.';
  return [...fonts].map(([key, { font, first, items }]) => ({
    about: `old-font:${key}`,
    text:
      items.size === 1
        ? `“${nameOf(first)}” · This presentation uses the old font “${font}”: ${install}`
        : `“${nameOf(first)}” and ${String(items.size - 1)} more · These presentations use the old font “${font}”: ${install}`,
  }));
}

function noticeFor(
  item: ImportItemReport,
  retry?: (paths: string[]) => Promise<unknown>,
  findMissing?: (mediaIds: string[]) => Promise<boolean>,
): Omit<ImportNotice, 'id'> | null {
  const failed = item.outcome === 'failed';
  const refused = failed || item.outcome === 'unsupported';
  const reasons = refused
    ? [item.message ?? 'Drashti couldn’t bring it in.']
    : item.issues.flatMap((issue) =>
        issue.severity === 'error' || missingParts.has(issue.code) || issue.code.endsWith('-left-out')
          ? [issue.message]
          : [],
      );
  if (reasons.length === 0) return null;

  const filename = nameOf(item);
  const fix = item.issues.find(
    (issue) => issue.code !== 'missing-presentation' && issue.fix?.kind === 'import-again',
  )?.fix;
  const missing = [
    ...new Set(
      item.issues.flatMap((issue) => (issue.fix?.kind === 'relink-media' ? [issue.fix.mediaId] : [])),
    ),
  ];
  const space = item.issues.find((issue) => issue.fix?.kind === 'free-space')?.fix;
  const path = (fix?.kind === 'import-again' ? fix.sourcePath : item.sourcePath).split('!/')[0];
  const canRetry = fix !== undefined || (failed && (item.format !== 'unknown' || space !== undefined));
  const freeSpace =
    space?.kind === 'free-space' ? ` Free up ${formatBytes(space.neededBytes)} and try again.` : '';
  return {
    text: `“${filename}” · ${[...new Set(reasons)].join(' ')}${freeSpace}`,
    retry: retry && path && canRetry ? () => retry([path]) : undefined,
    findMissing: findMissing && missing.length > 0 ? () => findMissing(missing) : undefined,
  };
}

/** The stored import details also drive the brief notices in both modes. */
export function showImportFailures(
  report: ImportReport,
  retry?: (paths: string[]) => Promise<unknown>,
  findMissing?: (mediaIds: string[]) => Promise<boolean>,
): void {
  // The old fonts first: a few lines that matter to the whole library, above any file's own.
  const notices = [
    ...oldFontNotices(report),
    ...report.items.flatMap((item) => {
      const notice = noticeFor(item, retry, findMissing);
      return notice ? [notice] : [];
    }),
  ];
  if (report.message !== null && report.status !== 'cancelled') notices.push({ text: report.message });
  show(notices);
}
