import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeZip } from './testing/zip-writer';
import { entryPath, extractZip, listZip, ZipError } from './zip';

const tmp = () => mkdtempSync(join(tmpdir(), 'drashti-zip-'));

describe('ZIP archives', () => {
  it('lists and extracts stored and deflated entries, with UTF-8 names', async () => {
    const dir = tmp();
    const zip = join(dir, 'bundle.zip');
    writeFileSync(
      zip,
      makeZip([
        { name: 'Song.pro6', data: '<RVPresentationDocument/>' },
        { name: 'Media/loop one.mov', data: 'x'.repeat(5000), deflate: true },
        { name: 'Media/નમૂનો.png', data: 'png' },
        { name: 'Media/', data: '' },
        { name: '__MACOSX/._Song.pro6', data: 'fork' },
        { name: 'Media/.DS_Store', data: 'x' },
      ]),
    );
    const entries = await listZip(zip);
    expect(entries.map((e) => [e.name, e.method, e.size])).toEqual([
      ['Song.pro6', 0, 25],
      ['Media/loop one.mov', 8, 5000],
      ['Media/નમૂનો.png', 0, 3],
      ['Media/', 0, 0],
      ['__MACOSX/._Song.pro6', 0, 4],
      ['Media/.DS_Store', 0, 1],
    ]);
    const out = join(dir, 'out');
    const result = await extractZip(zip, out);
    expect(
      result.files.map((f) =>
        f
          .slice(out.length + 1)
          .split(/[\\/]/u)
          .join('/'),
      ),
    ).toEqual(['Song.pro6', 'Media/loop one.mov', 'Media/નમૂનો.png']);
    expect(readFileSync(join(out, 'Media', 'loop one.mov'), 'utf8')).toBe('x'.repeat(5000));
    expect(readdirSync(out).sort()).toEqual(['Media', 'Song.pro6']);
  });

  it('refuses entries that would land outside the folder', async () => {
    const dir = tmp();
    const zip = join(dir, 'evil.zip');
    writeFileSync(
      zip,
      makeZip([
        { name: '../escape.txt', data: 'x' },
        { name: 'ok.txt', data: 'fine' },
      ]),
    );
    const result = await extractZip(zip, join(dir, 'out'));
    expect(result.skipped).toEqual([
      { name: '../escape.txt', reason: 'its path would leave the archive folder' },
    ]);
    expect(result.files).toHaveLength(1);
    expect(entryPath('/root', 'a/../../b')).toBeNull();
    expect(entryPath('/root', '/etc/passwd')).toBeNull();
    expect(entryPath('/root', 'C:\\x')).toBeNull();
    expect(entryPath('/root', 'a\\b.txt')).toBe(resolve('/root', 'a', 'b.txt'));
  });

  it('refuses archives too big to extract, and files that are not archives', async () => {
    const dir = tmp();
    const zip = join(dir, 'big.zip');
    writeFileSync(zip, makeZip([{ name: 'a.bin', data: Buffer.alloc(1000) }]));
    await expect(extractZip(zip, join(dir, 'out'), { maxBytes: 999 })).rejects.toThrow(ZipError);
    const notZip = join(dir, 'not.zip');
    writeFileSync(notZip, 'plain text');
    await expect(listZip(notZip)).rejects.toThrow('Not a ZIP archive');
  });

  it('stops an entry that inflates to more than it says', async () => {
    const dir = tmp();
    const zip = makeZip([{ name: 'bomb.txt', data: 'y'.repeat(100_000), deflate: true }]);
    // Claim the entry is only 10 bytes (both headers).
    zip.writeUInt32LE(10, 22);
    const cdAt = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt32LE(10, cdAt + 24);
    const path = join(dir, 'bomb.zip');
    writeFileSync(path, zip);
    await expect(extractZip(path, join(dir, 'out'))).rejects.toThrow('bigger than the archive says');
  });
});
