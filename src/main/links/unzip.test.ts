import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { makeDropboxLikeZip, makeZip } from '../import/testing/zip-writer';
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
    expect(result.ok ? null : result.rule).toBe('damaged');
    expect(readdirSync(dir)).toEqual(['.drashti-lie.part']);
  });

  it('unpacks a folder zipped as Dropbox zips it: a "/" entry, loose parts, folder entries, data descriptors', async () => {
    const dir = tmp();
    const zip = join(dir, '.drashti-dropbox.part');
    const files = [
      { path: 'Opening video.mp4', data: 'v'.repeat(5000) },
      { path: 'Placeholder deck.pptx', data: 'pptx bytes' },
      { path: 'Week 1/Videos/પ્રવચન ભાગ 1.mp4', data: 'g'.repeat(3000) },
      { path: 'Week 1/Videos/Deep folder/सभा भाग 2.mp4', data: 'h'.repeat(2000) },
      { path: 'Week 1/Decks/Placeholder katha.pptx', data: 'deck' },
      { path: 'Week 2/Read me.txt', data: 'placeholder words' },
    ];
    writeFileSync(zip, makeDropboxLikeZip(files));
    const result = await unpackFolderZip(zip, dir, 'Placeholder Dropbox folder', LIMITS);
    expect(result.ok ? '' : result.message).toBe('');
    if (!result.ok) return;
    // Every file, in its subfolders, three deep, its name as it was (spaces, Gujarati, Hindi).
    expect(listed(result.folder)).toEqual(files.map((f) => f.path).sort());
    for (const f of files)
      expect(readFileSync(join(result.folder, ...f.path.split('/')), 'utf8')).toBe(f.data);
    expect(result.files).toHaveLength(files.length);
    expect(readdirSync(dir).sort()).toEqual(['.drashti-dropbox.part', 'Placeholder Dropbox folder']);
  });

  it('skips an empty entry that names only the folder itself ("/", "./" or nothing), and refuses one with data', async () => {
    for (const name of ['/', './', '', '.', '//']) {
      const dir = tmp();
      const zip = zipFile(dir, [
        { name, data: '' },
        { name: 'clip.mp4', data: 'x' },
      ]);
      const result = await unpackFolderZip(zip, dir, 'Folder', LIMITS);
      expect(result.ok ? '' : result.message, JSON.stringify(name)).toBe('');
      if (result.ok) expect(listed(result.folder)).toEqual(['clip.mp4']);
    }
    // A file (with data) named as the folder itself has nowhere to go inside it: refused, as leaving it.
    for (const name of ['.', '', '\\']) {
      const dir = tmp();
      const zip = zipFile(dir, [{ name, data: 'placeholder' }]);
      const result = await unpackFolderZip(zip, dir, 'Folder', LIMITS);
      expect(result.ok ? null : result.rule, JSON.stringify(name)).toBe('leave');
      expect(readdirSync(dir)).toEqual(['.drashti-placeholder.part']);
    }
  });

  it('still refuses a Dropbox-like zip with any entry that leaves the folder, or a link', async () => {
    for (const bad of [
      { name: '../escaped.mp4', data: 'x' },
      { name: '/etc/placeholder.mp4', data: 'x' },
      { name: 'C:/placeholder.mp4', data: 'x' },
      { name: 'link.mp4', data: '/etc/passwd', unixMode: 0o120777 },
    ]) {
      const dir = tmp();
      const zip = join(dir, '.drashti-dropbox.part');
      // Written as Dropbox writes its zips, with one bad entry among the good.
      writeFileSync(
        zip,
        makeZip([
          { name: '/', data: '', descriptor: true },
          { name: 'Week 1/', data: '', descriptor: true },
          { name: 'Week 1/clip.mp4', data: 'x', descriptor: true },
          { ...bad, descriptor: true },
        ]),
      );
      const result = await unpackFolderZip(zip, dir, 'Folder', LIMITS);
      expect(result.ok ? null : result.rule, bad.name).toBe(bad.unixMode ? 'link' : 'leave');
      expect(readdirSync(dir)).toEqual(['.drashti-dropbox.part']);
    }
  });

  it('says which rule refused, as a short code', async () => {
    const dir = tmp();
    const rule = async (entries: Parameters<typeof makeZip>[0], limits = LIMITS) => {
      const r = await unpackFolderZip(zipFile(dir, entries), dir, 'Folder', limits);
      return r.ok ? null : r.rule;
    };
    expect(await rule([{ name: '../x.mp4', data: 'x' }])).toBe('leave');
    expect(await rule([{ name: 'l.mp4', data: '/etc/passwd', unixMode: 0o120777 }])).toBe('link');
    expect(
      await rule(
        [
          { name: 'a.mp4', data: 'x' },
          { name: 'b.mp4', data: 'x' },
        ],
        { ...LIMITS, maxFiles: 1 },
      ),
    ).toBe('count');
    expect(await rule([{ name: 'a.mp4', data: 'x'.repeat(2000) }], { ...LIMITS, maxBytes: 1000 })).toBe(
      'size',
    );
    expect(
      await rule([{ name: 'a.mp4', data: 'x'.repeat(1000) }], {
        ...LIMITS,
        freeBytes: () => 1500,
        keepFree: 1000,
      }),
    ).toBe('space');
    const odd = makeZip([{ name: 'a.mp4', data: 'x' }]);
    // Method 12 (bzip2), in both headers.
    odd.writeUInt16LE(12, 8);
    odd.writeUInt16LE(12, 30 + 'a.mp4'.length + 1 + 10);
    const oddZip = join(dir, '.drashti-odd.part');
    writeFileSync(oddZip, odd);
    const r = await unpackFolderZip(oddZip, dir, 'Folder', LIMITS);
    expect(r.ok ? null : r.rule).toBe('method');
    const broken = join(dir, '.drashti-broken.part');
    writeFileSync(broken, Buffer.from('not a zip at all'));
    const b = await unpackFolderZip(broken, dir, 'Folder', LIMITS);
    expect(b.ok ? null : b.rule).toBe('damaged');
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
