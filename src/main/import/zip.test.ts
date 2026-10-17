import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeZip } from './testing/zip-writer';
import { entryPath, extractZip, listZip, MAX_ZIP_ENTRIES, ZipError } from './zip';

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

/**
 * A ZIP64 archive's end, written by hand: its ZIP64 end record (at the file's start), the locator, and the
 * classic end record pointing at them. What it claims for its central directory is the test's to say.
 */
function zip64End(claims: { count: number; cdSize: bigint; cdOffset: bigint; recordAt?: bigint }): Buffer {
  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeBigUInt64LE(BigInt(claims.count), 24);
  record.writeBigUInt64LE(BigInt(claims.count), 32);
  record.writeBigUInt64LE(claims.cdSize, 40);
  record.writeBigUInt64LE(claims.cdOffset, 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(claims.recordAt ?? 0n, 8);
  locator.writeUInt32LE(1, 16);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([record, locator, end]);
}

describe('what a ZIP says of itself, checked before anything is read or allocated (Sessions 31–36, SEC-12)', () => {
  it('refuses a central directory bigger than the file, as the classic end record or ZIP64 says it', async () => {
    const dir = tmp();
    const zip = makeZip([{ name: 'a.txt', data: 'placeholder' }]);
    // The classic end record's size of the central directory, made bigger than the whole file.
    zip.writeUInt32LE(zip.length + 1000, zip.length - 22 + 12);
    writeFileSync(join(dir, 'big-cd.zip'), zip);
    await expect(listZip(join(dir, 'big-cd.zip'))).rejects.toThrow(
      'Broken central directory (it does not fit in the file).',
    );
    // ZIP64 saying 2^53 bytes: never allocated.
    writeFileSync(join(dir, 'huge-cd.zip'), zip64End({ count: 1, cdSize: 2n ** 53n - 1n, cdOffset: 0n }));
    const started = Date.now();
    await expect(listZip(join(dir, 'huge-cd.zip'))).rejects.toThrow(
      'Broken central directory (it does not fit in the file).',
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('refuses more than 100,000 entries, and a ZIP64 end record past the end of the file', async () => {
    const dir = tmp();
    expect(MAX_ZIP_ENTRIES).toBe(100_000);
    writeFileSync(join(dir, 'many.zip'), zip64End({ count: 200_000, cdSize: 46n, cdOffset: 0n }));
    await expect(listZip(join(dir, 'many.zip'))).rejects.toThrow(
      'This archive lists 200000 files: Drashti opens archives of 100,000 files at most.',
    );
    writeFileSync(
      join(dir, 'past.zip'),
      zip64End({ count: 1, cdSize: 46n, cdOffset: 0n, recordAt: 1_000_000n }),
    );
    await expect(listZip(join(dir, 'past.zip'))).rejects.toThrow('Broken ZIP64 archive.');
  });
});
