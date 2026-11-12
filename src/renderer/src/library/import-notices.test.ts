import { beforeEach, expect, it, vi } from 'vitest';
import { emptyTotals, NO_COUNTS } from '../../../shared/import';
import type { ImportIssue, ImportItemReport, ImportReport } from '../../../shared/import';
import {
  dismissAllImportNotices,
  findImportMedia,
  showImportFailures,
  showImportNotice,
  useImportNotices,
} from './import-notices';

beforeEach(() => {
  useImportNotices.setState({ notices: [] });
});

it('dismisses the whole import notice stack without retrying any file', () => {
  const retry = vi.fn(() => Promise.resolve());
  showImportNotice('Placeholder import one failed.', retry);
  showImportNotice('Placeholder import two failed.');
  expect(useImportNotices.getState().notices).toHaveLength(2);

  dismissAllImportNotices();

  expect(useImportNotices.getState().notices).toEqual([]);
  expect(retry).not.toHaveBeenCalled();
});

it('finds the missing files for the imported presentation and dismisses its notice after the search', async () => {
  const find = vi.fn<(ids: string[]) => Promise<boolean>>().mockResolvedValue(true);
  const report: ImportReport = {
    id: 'placeholder-run',
    paths: ['/placeholder/deck.pro6'],
    status: 'done',
    startedAt: '2026-11-12T00:00:00Z',
    finishedAt: '2026-11-12T00:00:01Z',
    totals: emptyTotals(),
    message: null,
    items: [
      {
        id: 'placeholder-item',
        sourcePath: '/placeholder/deck.pro6',
        format: 'pp6',
        outcome: 'imported',
        name: 'Placeholder slides',
        target: { kind: 'presentation', id: 'placeholder-slides' },
        counts: NO_COUNTS,
        message: null,
        issues: [
          {
            severity: 'warning',
            code: 'missing-media',
            message: 'Missing media: Placeholder video.mov.',
            fix: { kind: 'relink-media', mediaId: 'placeholder-video' },
          },
        ],
      },
    ],
  };
  showImportFailures(report, undefined, find);
  const [notice] = useImportNotices.getState().notices;
  expect(notice?.findMissing).toBeTypeOf('function');
  if (!notice) throw new Error('The import did not report the missing video.');

  await findImportMedia(notice);

  expect(find).toHaveBeenCalledExactlyOnceWith(['placeholder-video']);
  expect(useImportNotices.getState().notices).toEqual([]);
});

/** A finished import of these items. */
const reportOf = (items: ImportItemReport[]): ImportReport => ({
  id: 'placeholder-run',
  paths: items.map((item) => item.sourcePath),
  status: 'done',
  startedAt: '2026-11-12T00:00:00Z',
  finishedAt: '2026-11-12T00:00:01Z',
  totals: emptyTotals(),
  message: null,
  items,
});

/** A presentation that came in (or, with `outcome`, did not), with these issues. */
const deckOf = (
  name: string,
  issues: ImportIssue[],
  outcome: ImportItemReport['outcome'] = 'imported',
): ImportItemReport => ({
  id: `item-${name}`,
  sourcePath: `/placeholder/${name}.pro6`,
  format: 'pp6',
  outcome,
  name,
  target: outcome === 'imported' ? { kind: 'presentation', id: `presentation-${name}` } : null,
  counts: NO_COUNTS,
  message: outcome === 'imported' ? null : 'Placeholder: this file looks damaged. Repair it, then try again.',
  issues,
});

/** Words typed in an old Gujarati or Hindi font, as the import names them (main/import/legacy-fonts.ts). */
const oldFont = (font: string): ImportIssue => ({
  severity: 'warning',
  code: 'legacy-font',
  message: `Text in the legacy Gujarati font “${font}” (one text box) is kept as typed: it shows correctly only where that font is installed, and cannot be searched or transliterated until it is converted.`,
  fix: { kind: 'convert-font', font },
});

const INSTALL = 'install it on this computer, then quit and start Drashti again.';

it('names each old font an import met once, one line per font, with nothing to try again and nothing to find', () => {
  const retry = vi.fn(() => Promise.resolve());
  const find = vi.fn(() => Promise.resolve(true));
  showImportFailures(
    reportOf([
      deckOf('Placeholder Hymn', [
        oldFont('Placeholder Gopika'),
        oldFont('Placeholder Kruti Dev'),
        {
          severity: 'warning',
          code: 'missing-media',
          message: 'Missing media: Placeholder video.mov.',
          fix: { kind: 'relink-media', mediaId: 'placeholder-video' },
        },
      ]),
      deckOf('Placeholder Song', [oldFont('Placeholder Gopika')]),
      // Refused: it did not come in, so its font is not named until it does.
      deckOf('Placeholder Damaged', [oldFont('Placeholder Terafont')], 'failed'),
    ]),
    retry,
    find,
  );

  const notices = useImportNotices.getState().notices;
  expect(notices.map((notice) => notice.text)).toEqual([
    `“Placeholder Hymn” and 1 more · These presentations use the old font “Placeholder Gopika”: ${INSTALL}`,
    `“Placeholder Hymn” · This presentation uses the old font “Placeholder Kruti Dev”: ${INSTALL}`,
    '“Placeholder Hymn” · Missing media: Placeholder video.mov.',
    '“Placeholder Damaged” · Placeholder: this file looks damaged. Repair it, then try again.',
  ]);
  const [gopika, krutiDev, missing, damaged] = notices;
  // An old font is installed, never tried again or looked for: no Try again, no Find….
  for (const notice of [gopika, krutiDev]) {
    expect(notice?.retry).toBeUndefined();
    expect(notice?.findMissing).toBeUndefined();
  }
  expect(missing?.findMissing).toBeTypeOf('function');
  expect(damaged?.retry).toBeTypeOf('function');
});

it('keeps each old font once in the notices: a later import naming it again, in any case, takes its place', () => {
  showImportFailures(reportOf([deckOf('Placeholder Hymn', [oldFont('Placeholder Gopika')])]));
  showImportNotice('Placeholder notice in between.');
  showImportFailures(reportOf([deckOf('Placeholder Song', [oldFont('PLACEHOLDER GOPIKA')])]));

  expect(useImportNotices.getState().notices.map((notice) => notice.text)).toEqual([
    `“Placeholder Song” · This presentation uses the old font “PLACEHOLDER GOPIKA”: ${INSTALL}`,
    'Placeholder notice in between.',
  ]);
});
