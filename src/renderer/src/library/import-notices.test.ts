import { beforeEach, expect, it, vi } from 'vitest';
import { emptyTotals, NO_COUNTS } from '../../../shared/import';
import type { ImportReport } from '../../../shared/import';
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
