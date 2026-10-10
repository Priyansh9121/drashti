import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { makeZip } from '../import/testing/zip-writer';
import { unpackFolderZip } from './unzip';

const tmp = () => mkdtempSync(join(tmpdir(), 'drashti-unzip-'));
const LIMITS = { maxFiles: 100, maxBytes: 10 * 1024 * 1024, freeBytes: () => 100 * 1024 ** 3, keepFree: 0 };

function zipFile(dir: string, entries: Parameters<typeof makeZip>[0]): string {
  const zip = join(dir, '.drashti-placeholder.part');
  writeFileSync(zip, makeZip(entries));
  return zip;
}

const listed = (root: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(relative(root, full).split(/[\\/]/u).join('/'));
    }
  };
  walk(root);
  return out.sort();
};

describe('unpacking a Dropbox folder (a zip) safely', () => {
  it('unpacks into a new folder of its own, keeping the folders inside', async () => {
    const dir = tmp();
    const zip = zipFile(dir, [
      { name: 'Placeholder deck.pptx', data: 'pptx bytes' },
      { name: 'Videos/clip.mp4', data: 'v'.repeat(4000), deflate: true },
      { name: 'Videos/', data: '' },
      { name: 'notes.txt', data: 'placeholder' },
      { name: '__MACOSX/._notes.txt', data: 'fork' },
    ]);
    const result = await unpackFolderZip(zip, dir, 'Placeholder folder', LIMITS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.folder).toBe(join(dir, 'Placeholder folder'));
    expect(listed(result.folder)).toEqual(['Placeholder deck.pptx', 'Videos/clip.mp4', 'notes.txt']);
    expect(result.files.map((f) => relative(result.folder, f).split(/[\\/]/u).join('/')).sort()).toEqual([
      'Placeholder deck.pptx',
      'Videos/clip.mp4',
      'notes.txt',
    ]);
    expect(readFileSync(join(result.folder, 'Videos', 'clip.mp4'), 'utf8')).toBe('v'.repeat(4000));
    // Nothing unpacked can be run: no file gets the execute bits.
    if (process.platform !== 'win32') expect(statSync(join(result.folder, 'notes.txt')).mode & 0o111).toBe(0);
    // The zip itself is the caller's to remove; no work folder is left beside it.
    expect(readdirSync(dir).sort()).toEqual(['.drashti-placeholder.part', 'Placeholder folder']);
  });

  it('never writes over a folder already there', async () => {
    const dir = tmp();
    const zip = zipFile(dir, [{ name: 'a.mp4', data: 'x' }]);
    const first = await unpackFolderZip(zip, dir, 'Same name', LIMITS);
    const second = await unpackFolderZip(zip, dir, 'Same name', LIMITS);
    expect(first.ok && first.folder).toBe(join(dir, 'Same name'));
    expect(second.ok && second.folder).toBe(join(dir, 'Same name (2)'));
  });

  it('refuses the whole zip when any path would leave its folder (../)', async () => {
    const dir = tmp();
    const zip = zipFile(dir, [
      { name: 'fine.mp4', data: 'x' },
      { name: '../escaped.mp4', data: 'y' },
    ]);
    const result = await unpackFolderZip(zip, dir, 'Placeholder folder', LIMITS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/would leave/u);
    // Nothing at all was unpacked, inside or outside.
    expect(readdirSync(dir)).toEqual(['.drashti-placeholder.part']);
    expect(existsSync(join(dir, '..', 'escaped.mp4'))).toBe(false);
  });

  it('refuses absolute paths and drive letters too', async () => {
    for (const name of [
      '/etc/placeholder.mp4',
      'C:/placeholder.mp4',
      'a/../../b.mp4',
      'C:\\x\\..\\..\\y.mp4',
    ]) {
      const dir = tmp();
      const zip = zipFile(dir, [{ name, data: 'x' }]);
      const result = await unpackFolderZip(zip, dir, 'Placeholder folder', LIMITS);
      expect(result.ok, name).toBe(false);
      expect(readdirSync(dir)).toEqual(['.drashti-placeholder.part']);
    }
  });

  it('refuses a link to somewhere else (a symbolic link entry)', async () => {
    const dir = tmp();
    const zip = zipFile(dir, [{ name: 'link.mp4', data: '/etc/passwd', unixMode: 0o120777 }]);
    const result = await unpackFolderZip(zip, dir, 'Placeholder folder', LIMITS);
    expect(result.ok).toBe(false);
    expect(readdirSync(dir)).toEqual(['.drashti-placeholder.part']);
  });

  it('refuses more files than the limit, and more bytes than the limit', async () => {
    const dir = tmp();
    const many = zipFile(
      dir,
      Array.from({ length: 6 }, (_, i) => ({ name: `f${String(i)}.mp4`, data: 'x' })),
    );
    const tooMany = await unpackFolderZip(many, dir, 'Many', { ...LIMITS, maxFiles: 5 });
    expect(tooMany.ok ? '' : tooMany.message).toMatch(/more than 5 files/u);
    const big = zipFile(dir, [{ name: 'big.mp4', data: 'x'.repeat(2000), deflate: true }]);
    const tooBig = await unpackFolderZip(big, dir, 'Big', { ...LIMITS, maxBytes: 1000 });
    expect(tooBig.ok ? '' : tooBig.message).toMatch(/too big/u);
    expect(readdirSync(dir).filter((n) => !n.startsWith('.drashti'))).toEqual([]);
  });

  it('refuses to unpack when it would leave less than the space kept free', async () => {
    const dir = tmp();
    const zip = zipFile(dir, [{ name: 'a.mp4', data: 'x'.repeat(1000) }]);
    const result = await unpackFolderZip(zip, dir, 'Folder', {
      ...LIMITS,
      freeBytes: () => 1500,
      keepFree: 1000,
    });
    expect(result.ok ? '' : result.message).toMatch(/free/u);
    expect(readdirSync(dir)).toEqual(['.drashti-placeholder.part']);
  });

  it('stops an entry that unpacks bigger than the zip says, and keeps nothing', async () => {
    const dir = tmp();
    const zip = join(dir, '.drashti-lie.part');
    // An entry that says 10 bytes but inflates to 100,000.
    const lie = Buffer.from(makeZip([{ name: 'lie.mp4', data: 'x'.repeat(100_000), deflate: true }]));
    const body = deflateRawSync(Buffer.from('x'.repeat(100_000)));
    // Patch both size fields (local header at 0, central directory after the body).
    lie.writeUInt32LE(10, 22);
    lie.writeUInt32LE(10, 30 + 'lie.mp4'.length + body.length + 24);
    writeFileSync(zip, lie);
    const result = await unpackFolderZip(zip, dir, 'Folder', LIMITS);
    expect(result.ok).toBe(false);
    expect(readdirSync(dir)).toEqual(['.drashti-lie.part']);
  });

  it('makes names inside the zip safe for Windows too', async () => {
    const dir = tmp();
    const zip = zipFile(dir, [
      { name: 'Sub: one/clip?.mp4', data: 'x' },
      { name: 'CON.pptx', data: 'y' },
      { name: 'Sub_ one/clip_.mp4', data: 'z' },
    ]);
    const result = await unpackFolderZip(zip, dir, 'Folder', LIMITS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(listed(result.folder)).toEqual(['Sub_ one/clip_ (2).mp4', 'Sub_ one/clip_.mp4', '_CON.pptx']);
  });
});
