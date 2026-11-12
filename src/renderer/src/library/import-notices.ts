import { create } from 'zustand';
import { formatBytes } from '../../../shared/format';
import type { ImportItemReport, ImportReport, RefusedImport } from '../../../shared/import';

interface ImportNotice {
  id: number;
  text: string;
  retry?: () => Promise<unknown>;
  findMissing?: () => Promise<boolean>;
  /**
   * What it says, for words a later notice may say again (an import's old fonts): a newer notice that says all of an
   * older one's takes its place.
   */
  about?: string[];
}

export const useImportNotices = create<{ notices: ImportNotice[] }>(() => ({ notices: [] }));

let nextId = 0;

function show(notices: Omit<ImportNotice, 'id'>[]): void {
  if (notices.length === 0) return;
  // A new notice that says all an older one says (its old fonts, say) takes its place.
  const saysAgain = (older: ImportNotice): boolean => {
    const said = older.about;
    if (said === undefined || said.length === 0) return false;
    return notices.some((notice) => said.every((what) => notice.about?.includes(what) === true));
  };
  useImportNotices.setState((s) => ({
    notices: [
      ...notices.map((notice) => ({ ...notice, id: ++nextId })),
      ...s.notices.filter((notice) => !saysAgain(notice)),
    ],
  }));
}

export function showImportNotice(text: string, retry?: () => Promise<unknown>): void {
  show([{ text, retry }]);
}

export function showRefusedImports(refused: readonly RefusedImport[]): void {
  show(refused.map(({ name, reason }) => ({ text: `“${name}” · ${reason}` })));
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
  'calendar-note',
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
  'shastra-note',
  'unsupported-element',
]);

const nameOf = (item: ImportItemReport): string =>
  item.name ?? item.sourcePath.split(/[\\/]/u).at(-1) ?? 'File';

/** “A”, “A” and “B”, “A”, “B” and “C”. */
const quoted = (names: string[]): string => {
  const all = names.map((name) => `“${name}”`);
  return all.length <= 1 ? (all[0] ?? '') : `${all.slice(0, -1).join(', ')} and ${all.at(-1) ?? ''}`;
};

/**
 * Words typed in an old (legacy) Gujarati or Hindi font are kept as typed and drawn in that font, so they read right
 * only where it is installed (main/import/legacy-fonts.ts): on this computer and on each node, which draws them itself
 * (admin guide, section 11). One line for an import, naming each of its old fonts once however many presentations use
 * it, so it never takes more than one of the four lines shown from the files' own (their Try again and Find…).
 * Installing is the only answer: no Try again, no Find…. Drashti draws in the font once it is on the computer and
 * Drashti has started again; importing again would change nothing (an unchanged file is skipped).
 */
function oldFontsNotice(report: ImportReport): Omit<ImportNotice, 'id'> | null {
  const fonts = new Map<string, string>();
  const items: ImportItemReport[] = [];
  for (const item of report.items) {
    // A refused file did not come in: its fonts are named once it does.
    if (item.outcome === 'failed' || item.outcome === 'unsupported') continue;
    let uses = false;
    for (const issue of item.issues) {
      if (issue.code !== 'legacy-font' || issue.fix?.kind !== 'convert-font') continue;
      const font = issue.fix.font.trim();
      if (font === '') continue;
      uses = true;
      // A font's name in any case is the same font, as the computer finds it.
      const key = font.toLowerCase();
      if (!fonts.has(key)) fonts.set(key, font);
    }
    if (uses) items.push(item);
  }
  const [first] = items;
  if (!first) return null;
  const one = fonts.size === 1;
  const what = `the old ${one ? 'font' : 'fonts'} ${quoted([...fonts.values()])}: install ${one ? 'it' : 'them'} on this computer and on each node, then quit and start Drashti again on each.`;
  return {
    about: [...fonts.keys()].map((key) => `old-font:${key}`),
    text:
      items.length === 1
        ? `“${nameOf(first)}” · This presentation uses ${what}`
        : `“${nameOf(first)}” and ${String(items.length - 1)} more · These presentations use ${what}`,
  };
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
  // The old fonts first, in one line: they matter to the whole library, and take one line from the files' own.
  const fonts = oldFontsNotice(report);
  const notices = [
    ...(fonts ? [fonts] : []),
    ...report.items.flatMap((item) => {
      const notice = noticeFor(item, retry, findMissing);
      return notice ? [notice] : [];
    }),
  ];
  if (report.message !== null && report.status !== 'cancelled') notices.push({ text: report.message });
  show(notices);
}
