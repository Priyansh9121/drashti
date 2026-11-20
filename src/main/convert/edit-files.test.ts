import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../db/database';
import { openDatabase } from '../db/database';
import { MediaRepo } from '../db/media';
import { registerEditedFile } from './edit-files';
import type { MediaInfo } from './plan';
import type { SourceWrite } from '../documents/source-write';

let dir = '';
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-edit-files-'));
  db = openDatabase(':memory:');
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
const info: MediaInfo = {
  durationMs: 1000,
  video: { codec: 'h264', pixFmt: 'yuv420p', width: 64, height: 48, still: false },
  audio: null,
};
const write: SourceWrite = (guard, run) => {
  if (!guard.allowed() || guard.signal.aborted) return Promise.reject(new Error('Stopped'));
  return Promise.resolve(run());
};
it('registers only the prepared bytes as unlisted immutable media, leaving the source untouched', async () => {
  const source = join(dir, 'Source placeholder.mp4');
  writeFileSync(source, 'source-placeholder');
  const output = join(dir, 'Prepared placeholder.mp4');
  writeFileSync(output, 'prepared-placeholder');
  const id = await registerEditedFile({
    db,
    mediaDir: dir,
    file: output,
    name: 'Placeholder edited',
    info,
    signal: new AbortController().signal,
    idle: () => true,
    freeBytes: () => 10 * 1024 ** 3,
    write,
  });
  const row = new MediaRepo(db).kindAndFile(id);
  expect(row).toMatchObject({ kind: 'video', missing: false });
  expect(readFileSync(join(dir, row?.path ?? ''), 'utf8')).toBe('prepared-placeholder');
  expect(readFileSync(source, 'utf8')).toBe('source-placeholder');
  expect(new MediaRepo(db).lengthOf(id)).toBe(1000);
  expect(db.prepare('SELECT listed FROM media WHERE id=?').get(id)).toEqual({ listed: 0 });
});
it('refuses an aborted preparation before any media row is published', async () => {
  const output = join(dir, 'Prepared placeholder.mp4');
  writeFileSync(output, 'prepared-placeholder');
  const control = new AbortController();
  control.abort();
  await expect(
    registerEditedFile({
      db,
      mediaDir: dir,
      file: output,
      name: 'Placeholder',
      info,
      signal: control.signal,
      idle: () => true,
      freeBytes: () => 10 * 1024 ** 3,
      write,
    }),
  ).rejects.toThrow();
  expect(db.prepare('SELECT count(*) AS n FROM media').get()).toEqual({ n: 0 });
  expect(readFileSync(output, 'utf8')).toBe('prepared-placeholder');
});
