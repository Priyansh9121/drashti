import { afterEach, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportCopy, exportOffer } from './export-copy';

/*
 * Export… (alpha.22; the owner, 24 Nov 2026: "export button as well to download"): a finished video copied, byte for
 * byte, to a file the operator chooses in the system's save dialog, offered in Downloads under its own name. Nothing is
 * encoded again; a file there is replaced only once the system's own dialog asked; the copy lands whole or not at all.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function place() {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-export-copy-'));
  dirs.push(dir);
  const source = join(dir, 'made.mp4');
  writeFileSync(source, Buffer.from('placeholder combined video bytes'));
  return { dir, source, downloads: join(dir, 'Downloads') };
}
const free = () => 100 * 1024 ** 3;

it('offers Downloads and the video’s name, then copies the very bytes to the file chosen', async () => {
  const { dir, source, downloads } = place();
  const offered: string[] = [];
  const dest = join(dir, 'chosen.mp4');
  const result = await exportCopy({
    source,
    name: 'Opening + Talk.mp4',
    downloads,
    pick: (path) => {
      offered.push(path);
      return Promise.resolve(dest);
    },
    idle: () => true,
    freeBytes: free,
  });
  expect(result).toEqual({ ok: true, path: dest });
  expect(offered).toEqual([join(downloads, 'Opening + Talk.mp4')]);
  expect(readFileSync(dest)).toEqual(readFileSync(source));
  expect(readdirSync(dir).filter((name) => name.includes('.part'))).toEqual([]);
  expect(exportOffer(downloads, 'A/B: C.mp4')).toBe(join(downloads, 'A_B_ C.mp4'));
});

it('writes nothing when the dialog is cancelled, the source is chosen, or the show is not idle', async () => {
  const { dir, source, downloads } = place();
  const base = { source, name: 'Opening + Talk.mp4', downloads, idle: () => true, freeBytes: free };
  expect(await exportCopy({ ...base, pick: () => Promise.resolve(null) })).toEqual({ ok: true, path: null });
  expect(await exportCopy({ ...base, pick: () => Promise.resolve(source) })).toMatchObject({
    ok: false,
    message: /another place/u,
  });
  const dest = join(dir, 'busy.mp4');
  expect(await exportCopy({ ...base, idle: () => false, pick: () => Promise.resolve(dest) })).toMatchObject({
    ok: false,
    message: /while anything is up, streaming or recording/u,
  });
  expect(existsSync(dest)).toBe(false);
  expect(
    await exportCopy({ ...base, freeBytes: () => 1024, pick: () => Promise.resolve(join(dir, 'full.mp4')) }),
  ).toMatchObject({ ok: false, message: /2 GB free/u });
  expect(existsSync(join(dir, 'full.mp4'))).toBe(false);
});

it('replaces a file the system’s dialog asked about, whole, with no part file left', async () => {
  const { dir, source, downloads } = place();
  const dest = join(dir, 'there.mp4');
  writeFileSync(dest, 'an older file');
  const result = await exportCopy({
    source,
    name: 'Opening + Talk.mp4',
    downloads,
    pick: () => Promise.resolve(dest),
    idle: () => true,
    freeBytes: free,
  });
  expect(result).toEqual({ ok: true, path: dest });
  expect(readFileSync(dest, 'utf8')).toBe('placeholder combined video bytes');
  expect(readdirSync(dir).sort()).toEqual(['made.mp4', 'there.mp4']);
});
