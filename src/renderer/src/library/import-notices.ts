import { create } from 'zustand';
import { formatBytes } from '../../../shared/format';
import type { ImportItemReport, ImportReport } from '../../../shared/import';

interface ImportNotice {
  id: number;
  text: string;
  retry?: () => Promise<unknown>;
  findMissing?: () => Promise<boolean>;
}

export const useImportNotices = create<{ notices: ImportNotice[] }>(() => ({ notices: [] }));

let nextId = 0;

function show(notices: Omit<ImportNotice, 'id'>[]): void {
  if (notices.length === 0) return;
  useImportNotices.setState((s) => ({
    notices: [...notices.map((notice) => ({ ...notice, id: ++nextId })), ...s.notices],
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

  const filename = item.name ?? item.sourcePath.split(/[\\/]/u).at(-1) ?? 'File';
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
  const notices = report.items.flatMap((item) => {
    const notice = noticeFor(item, retry, findMissing);
    return notice ? [notice] : [];
  });
  if (report.message !== null && report.status !== 'cancelled') notices.push({ text: report.message });
  show(notices);
}
