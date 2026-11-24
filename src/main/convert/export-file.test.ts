import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportedNotice } from '../../shared/export-file';
import { exportMediaFile } from './export-file';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'drashti-export-file-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Export… of a finished video (alpha.22)', () => {
  it('copies the file byte for byte where chosen, never over one there, and the original stays', async () => {
    const source = join(dir, 'abc.mp4');
    await writeFile(source, 'placeholder trimmed bytes');
    const out = join(dir, 'Downloads');
    await mkdir(out);
    const deps = {
      video: (id: string) => (id === 'cut' ? { path: source, name: 'Placeholder trimmed.mp4' } : null),
      pickDest: (name: string) => Promise.resolve(join(out, name)),
    };
    const first = await exportMediaFile(deps, 'cut');
    expect(first).toEqual({ ok: true, path: join(out, 'Placeholder trimmed.mp4') });
    expect(await readFile(join(out, 'Placeholder trimmed.mp4'), 'utf8')).toBe('placeholder trimmed bytes');
    const second = await exportMediaFile(deps, 'cut');
    expect(second).toEqual({ ok: true, path: join(out, 'Placeholder trimmed (2).mp4') });
    expect(await readFile(source, 'utf8')).toBe('placeholder trimmed bytes');
    expect(exportedNotice(join(out, 'Placeholder trimmed (2).mp4'))).toBe(
      'Exported “Placeholder trimmed (2).mp4” to Downloads.',
    );
  });

  it('does nothing when the dialog is closed, and says so when the video is gone', async () => {
    let asked = 0;
    const closed = await exportMediaFile(
      {
        video: () => ({ path: join(dir, 'x.mp4'), name: 'Placeholder.mp4' }),
        pickDest: () => {
          asked++;
          return Promise.resolve(null);
        },
      },
      'cut',
    );
    expect(closed).toEqual({ ok: true, path: null });
    expect(asked).toBe(1);
    expect(
      await exportMediaFile({ video: () => null, pickDest: () => Promise.resolve(null) }, 'cut'),
    ).toEqual({
      ok: false,
      message: 'That video is no longer in Media to export.',
    });
  });
});
