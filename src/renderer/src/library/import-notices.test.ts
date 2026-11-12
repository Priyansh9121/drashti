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

it('shows which imported slide uses an approximation for its animation', () => {
  const message = 'Placeholder slide 2 uses the closest playable effect.';
  showImportFailures(
    reportOf([
      {
        ...deckOf('Placeholder slides', [
          { severity: 'warning', code: 'deck-motion-approximated', message, fix: null },
        ]),
        sourcePath: '/placeholder/deck.pptx',
        format: 'pictures',
      },
    ]),
  );
  expect(useImportNotices.getState().notices).toMatchObject([{ text: `“Placeholder slides” · ${message}` }]);
});

it.each([
  {
    format: 'calendar' as const,
    code: 'calendar-note',
    name: 'Placeholder calendar',
    message: 'Day 2 was left out: the date is missing.',
  },
  {
    format: 'shastra' as const,
    code: 'shastra-note',
    name: 'Placeholder book (PB)',
    message: 'Item 2 has no words: it was left out.',
  },
])('shows one notice for warnings in a $format file', ({ format, code, name, message }) => {
  const item: ImportItemReport = {
    ...deckOf(name, [
      { severity: 'warning', code, message, fix: null },
      { severity: 'warning', code, message, fix: null },
      { severity: 'info', code, message: 'Placeholder information.', fix: null },
    ]),
    format,
    sourcePath: `/placeholder/${format}.json`,
    target: { kind: format, id: 'placeholder-id' },
  };
  showImportFailures(reportOf([item]), vi.fn());
  expect(useImportNotices.getState().notices).toMatchObject([
    { text: `“${name}” · ${message}`, retry: undefined },
  ]);
});

it.each(['deck-other-app', 'pictures-converter'])('shows only the %s warning, once', (code) => {
  const message = 'Another app prepared the placeholder deck. Check its slides before the show.';
  const warning = { severity: 'warning' as const, code, message, fix: null };
  const info = { severity: 'info' as const, code, message: 'Placeholder successful conversion.', fix: null };
  showImportFailures(
    reportOf([
      deckOf('Placeholder deck', [warning, warning, info]),
      deckOf('Placeholder converted deck', [info]),
    ]),
  );
  expect(useImportNotices.getState().notices).toMatchObject([
    { text: `“Placeholder deck” · ${message}`, whole: true },
  ]);
});

it('says when an import replaced the markers of media already in the library', () => {
  const message = 'Placeholder clip has the start, end and markers from this import now.';
  const issue = { severity: 'info' as const, code: 'markers-replaced', message, fix: null };
  showImportFailures(reportOf([deckOf('Placeholder deck', [issue, issue])]));
  expect(useImportNotices.getState().notices).toMatchObject([
    {
      text: `“Placeholder deck” · ${message} Check the new points and markers before playing the media again.`,
      whole: true,
    },
  ]);
});

/** Words typed in an old Gujarati or Hindi font, as the import names them (main/import/legacy-fonts.ts). */
const oldFont = (font: string): ImportIssue => ({
  severity: 'warning',
  code: 'legacy-font',
  message: `Text in the legacy Gujarati font “${font}” (one text box) is kept as typed: it shows correctly only where that font is installed, and cannot be searched or transliterated until it is converted.`,
  fix: { kind: 'convert-font', font },
});

/** What to do: on this computer and on each node, which draws these slides itself (admin guide, section 11). */
const INSTALL_IT = 'install it on this computer and on each node, then quit and start Drashti again on each.';
const INSTALL_THEM =
  'install them on this computer and on each node, then quit and start Drashti again on each.';

it('names the old fonts an import met in one line, each font once, with nothing to try again and nothing to find', () => {
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
      // The same font in another case is the same font.
      deckOf('Placeholder Song', [oldFont('placeholder gopika')]),
      // Refused: it did not come in, so its font is not named until it does.
      deckOf('Placeholder Damaged', [oldFont('Placeholder Terafont')], 'failed'),
    ]),
    retry,
    find,
  );

  const notices = useImportNotices.getState().notices;
  expect(notices.map((notice) => notice.text)).toEqual([
    `“Placeholder Hymn” and 1 more · These presentations use the old fonts “Placeholder Gopika” and “Placeholder Kruti Dev”: ${INSTALL_THEM}`,
    '“Placeholder Hymn” · Missing media: Placeholder video.mov.',
    '“Placeholder Damaged” · Placeholder: this file looks damaged. Repair it, then try again.',
  ]);
  const [fonts, missing, damaged] = notices;
  // An old font is installed, never tried again or looked for: no Try again, no Find….
  expect(fonts?.retry).toBeUndefined();
  expect(fonts?.findMissing).toBeUndefined();
  // Drawn whole, so every font can be read (ImportNoticeLine); a file's own line stays one line.
  expect(fonts?.whole).toBe(true);
  expect(missing?.whole).toBeUndefined();
  expect(missing?.findMissing).toBeTypeOf('function');
  expect(damaged?.retry).toBeTypeOf('function');
});

it('keeps every refused file’s Try again in the four lines shown, however many old fonts the import met', () => {
  const retry = vi.fn(() => Promise.resolve());
  const fonts = [
    'Placeholder Gopika',
    'Placeholder Kruti Dev',
    'Placeholder Terafont',
    'Placeholder LMG-Arun',
    'Placeholder Shree Guj',
  ];
  showImportFailures(
    reportOf([
      deckOf(
        'Placeholder Hymn',
        fonts.map((font) => oldFont(font)),
      ),
      deckOf('Placeholder Damaged One', [], 'failed'),
      deckOf('Placeholder Damaged Two', [], 'failed'),
      deckOf('Placeholder Damaged Three', [], 'failed'),
    ]),
    retry,
  );

  const notices = useImportNotices.getState().notices;
  expect(notices.map((notice) => notice.text)).toEqual([
    `“Placeholder Hymn” · This presentation uses the old fonts “Placeholder Gopika”, “Placeholder Kruti Dev”, “Placeholder Terafont”, “Placeholder LMG-Arun” and “Placeholder Shree Guj”: ${INSTALL_THEM}`,
    '“Placeholder Damaged One” · Placeholder: this file looks damaged. Repair it, then try again.',
    '“Placeholder Damaged Two” · Placeholder: this file looks damaged. Repair it, then try again.',
    '“Placeholder Damaged Three” · Placeholder: this file looks damaged. Repair it, then try again.',
  ]);
  // The window shows the newest four lines (NoticeArea): each refused file's Try again is among them.
  expect(notices.slice(0, 4).filter((notice) => notice.retry !== undefined)).toHaveLength(3);
});

it('a later old-fonts line naming every font of an earlier one, in any case, takes its place; one naming another font leaves it', () => {
  const texts = () => useImportNotices.getState().notices.map((notice) => notice.text);
  showImportFailures(reportOf([deckOf('Placeholder Hymn', [oldFont('Placeholder Gopika')])]));
  showImportNotice('Placeholder notice in between.');
  showImportFailures(reportOf([deckOf('Placeholder Prayer', [oldFont('Placeholder Kruti Dev')])]));
  showImportFailures(reportOf([deckOf('Placeholder Song', [oldFont('PLACEHOLDER GOPIKA')])]));

  // Gopika's earlier line goes; Kruti Dev's stays, as the new line does not name it.
  expect(texts()).toEqual([
    `“Placeholder Song” · This presentation uses the old font “PLACEHOLDER GOPIKA”: ${INSTALL_IT}`,
    `“Placeholder Prayer” · This presentation uses the old font “Placeholder Kruti Dev”: ${INSTALL_IT}`,
    'Placeholder notice in between.',
  ]);

  showImportFailures(
    reportOf([
      deckOf('Placeholder Psalm', [oldFont('Placeholder Kruti Dev'), oldFont('Placeholder Gopika')]),
    ]),
  );
  expect(texts()).toEqual([
    `“Placeholder Psalm” · This presentation uses the old fonts “Placeholder Kruti Dev” and “Placeholder Gopika”: ${INSTALL_THEM}`,
    'Placeholder notice in between.',
  ]);
});

it('shows one notice when the Keynote PowerPoint copy is left out', () => {
  const message =
    'Edit slides uses the PDF. To edit from PowerPoint, export the deck from Keynote as PowerPoint and import that file.';
  const issue = { severity: 'warning' as const, code: 'keynote-copy-left-out', message, fix: null };
  showImportFailures(reportOf([deckOf('Placeholder Keynote deck', [issue, issue])]));
  expect(useImportNotices.getState().notices).toMatchObject([
    { text: `“Placeholder Keynote deck” · ${message}` },
  ]);
});
