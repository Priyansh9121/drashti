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

  it('keeps the file’s own type: its extension is added when the name chosen does not end with it (the save-trim review nit)', async () => {
    // The save dialog has no filters, so a name typed without ".mp4" saved a file without an extension.
    const source = join(dir, 'abc.mp4');
    await writeFile(source, 'placeholder trimmed bytes');
    const out = join(dir, 'Downloads');
    await mkdir(out);
    const offered: string[] = [];
    let typed = 'Placeholder typed';
    const deps = {
      video: (id: string) => (id === 'cut' ? { path: source, name: 'Placeholder renamed' } : null),
      pickDest: (name: string) => {
        offered.push(name);
        return Promise.resolve(join(out, typed));
      },
    };
    // A video renamed in Media without its extension is offered with it.
    expect(await exportMediaFile(deps, 'cut')).toEqual({
      ok: true,
      path: join(out, 'Placeholder typed.mp4'),
    });
    expect(offered).toEqual(['Placeholder renamed.mp4']);
    expect(await readFile(join(out, 'Placeholder typed.mp4'), 'utf8')).toBe('placeholder trimmed bytes');
    // A dot in the name is not its type.
    typed = 'Placeholder talk 1.5';
    expect(await exportMediaFile(deps, 'cut')).toEqual({
      ok: true,
      path: join(out, 'Placeholder talk 1.5.mp4'),
    });
    // Its own extension, in any case, is kept as typed; another one has the file's own added.
    typed = 'Placeholder upper.MP4';
    expect(await exportMediaFile(deps, 'cut')).toEqual({
      ok: true,
      path: join(out, 'Placeholder upper.MP4'),
    });
    typed = 'Placeholder other.mov';
    expect(await exportMediaFile(deps, 'cut')).toEqual({
      ok: true,
      path: join(out, 'Placeholder other.mov.mp4'),
    });
    // A free name beside one already there, as before.
    typed = 'Placeholder typed';
    expect(await exportMediaFile(deps, 'cut')).toEqual({
      ok: true,
      path: join(out, 'Placeholder typed (2).mp4'),
    });
  });
});
