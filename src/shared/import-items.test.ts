import { describe, expect, it } from 'vitest';
import { NO_COUNTS, type ImportItemReport } from './import';
import { itemsMadeBy } from './import-items';

const item = (
  sourcePath: string,
  target: ImportItemReport['target'],
  outcome: ImportItemReport['outcome'] = 'imported',
): ImportItemReport => ({
  id: sourcePath,
  sourcePath,
  format: 'pictures',
  outcome,
  name: null,
  target,
  counts: NO_COUNTS,
  message: null,
  issues: [],
});

describe('what an import made, as playlist items', () => {
  it('follows the order the files were given, not the report’s', () => {
    const report = [
      item('/in/b.png', { kind: 'media', id: 'm-b' }),
      item('/in/a.pro6', { kind: 'presentation', id: 'p-a' }),
    ];
    expect(itemsMadeBy(report, ['/in/a.pro6', '/in/b.png'])).toEqual([
      { kind: 'presentation', presentationId: 'p-a' },
      { kind: 'media', mediaId: 'm-b' },
    ]);
  });

  it('takes a folder’s files and a bundle’s, in the report’s order for each, but never a neighbour with a longer name', () => {
    const report = [
      item('/in/Folder/one.mp4', { kind: 'media', id: 'm-1' }),
      item('/in/Folder2/other.mp4', { kind: 'media', id: 'm-x' }),
      item('C:\\in\\Folder\\two.pptx', { kind: 'presentation', id: 'p-2' }),
      item('/in/set.pro6x!/inner/Song.pro6', { kind: 'presentation', id: 'p-s' }),
    ];
    expect(itemsMadeBy(report, ['/in/Folder', '/in/set.pro6x'])).toEqual([
      { kind: 'media', mediaId: 'm-1' },
      { kind: 'presentation', presentationId: 'p-s' },
    ]);
    expect(itemsMadeBy(report, ['C:\\in\\Folder'])).toEqual([
      { kind: 'presentation', presentationId: 'p-2' },
    ]);
  });

  it('leaves out what failed or was not imported, and anything not a presentation or media; each once', () => {
    const report = [
      item('/in/a.png', { kind: 'media', id: 'm-a' }),
      item('/in/same.png', { kind: 'media', id: 'm-a' }),
      item('/in/bad.pptx', null, 'failed'),
      item('/in/list.pro6pl', { kind: 'playlist', id: 'pl' }),
      item('/in/old.pro6', { kind: 'presentation', id: 'p-old' }, 'skipped'),
      item('/in/wait.pro6', { kind: 'presentation', id: 'p-wait' }, 'conflict'),
    ];
    expect(
      itemsMadeBy(report, [
        '/in/a.png',
        '/in/same.png',
        '/in/bad.pptx',
        '/in/list.pro6pl',
        '/in/old.pro6',
        '/in/wait.pro6',
      ]),
    ).toEqual([
      { kind: 'media', mediaId: 'm-a' },
      { kind: 'presentation', presentationId: 'p-old' },
    ]);
  });
});
