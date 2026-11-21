import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DisplayCopies } from './display-copies';

const live: { copies: DisplayCopies; dir: string }[] = [];
afterEach(() => {
  for (const item of live.splice(0)) {
    item.copies.close();
    rmSync(item.dir, { recursive: true, force: true });
  }
});

function png(width: number, height: number): Buffer {
  const head = Buffer.alloc(45);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(head);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12);
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  head[24] = 8;
  head[25] = 6;
  head.write('IDAT', 37);
  return head;
}

it('publishes the same verified display rendition from its owned native Blob file, without a result byte array', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-display-native-file-'));
  const original = png(6144, 3456);
  const sha = createHash('sha256').update(original).digest('hex');
  const source = `${sha.slice(0, 2)}/${sha}.png`;
  mkdirSync(join(dir, sha.slice(0, 2)));
  writeFileSync(join(dir, source), original);
  const output = png(1920, 1080);
  // The previous path wrote these bytes directly and used this exact SHA256 algorithm.
  const oldChecksum = Buffer.from(await webcrypto.subtle.digest('SHA-256', new Uint8Array(output))).toString(
    'hex',
  );
  const blob = { url: `blob:null/${randomUUID()}`, bytes: output.length };
  const saveBlob = vi.fn(async (received: { url: string; bytes: number }, destination: string) => {
    expect(received).toEqual(blob);
    await writeFile(destination, output);
  });
  const changed = vi.fn<() => void>();
  const copies = new DisplayCopies({
    mediaDir: dir,
    targets: () => [{ width: 1920, height: 1080 }],
    open: () => ({ id: 1, beforeBytes: () => undefined, destroy: () => undefined, saveBlob }),
    changed,
    log: () => undefined,
    freeBytes: () => 10 * 1024 ** 3,
  });
  live.push({ copies, dir });
  const prepared = copies.prepare({ path: source, sha256: sha });
  // The existing service opens its worker asynchronously after checking the original and cache.
  await vi.waitFor(() => expect(copies.working).toBe(true));
  const job = await copies.next(1);
  if (!job) throw new Error('The generated native-file job was not granted.');
  expect(copies.ready(sha)).toBeNull();
  const made = copies.made(1, job.key, blob);
  const result = await prepared;
  await made;
  expect(result).toMatchObject({
    ok: true,
    copy: {
      width: 1920,
      height: 1080,
      bytes: output.length,
      hash: oldChecksum,
    },
  });
  expect(saveBlob).toHaveBeenCalledOnce();
  if (!result.ok || !result.copy) throw new Error('The checked native file was not published.');
  expect(readFileSync(join(dir, result.copy.path))).toEqual(output);
  expect(readFileSync(join(dir, source))).toEqual(original);
  expect(changed).toHaveBeenCalledOnce();
});

function existingPicture() {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-display-existing-'));
  const original = png(6144, 3456);
  const sha = createHash('sha256').update(original).digest('hex');
  const source = `${sha.slice(0, 2)}/${sha}.png`;
  mkdirSync(join(dir, sha.slice(0, 2)));
  writeFileSync(join(dir, source), original);
  const saveBlob = vi.fn(() => Promise.reject(new Error('This case has no Blob to save.')));
  const open = vi.fn(() => ({ id: 1, beforeBytes: () => undefined, destroy: () => undefined, saveBlob }));
  const changed = vi.fn<() => void>();
  const copies = new DisplayCopies({
    mediaDir: dir,
    targets: () => [{ width: 1920, height: 1080 }],
    open,
    changed,
    log: () => undefined,
    freeBytes: () => 10 * 1024 ** 3,
  });
  live.push({ copies, dir });
  return { copies, dir, original, source, sha, open, saveBlob, changed };
}

it('loads a previously written display cache with its exact bytes and checksum, without opening a worker', async () => {
  const t = existingPicture();
  const oldBytes = png(1920, 1080);
  const oldChecksum = Buffer.from(
    await webcrypto.subtle.digest('SHA-256', new Uint8Array(oldBytes)),
  ).toString('hex');
  const relative = `display/v1-${t.sha}-1920x1080.png`;
  mkdirSync(join(t.dir, 'display'));
  writeFileSync(join(t.dir, relative), oldBytes);
  const result = await t.copies.prepare({ path: t.source, sha256: t.sha });
  expect(result).toMatchObject({
    ok: true,
    copy: { path: relative, hash: oldChecksum, bytes: oldBytes.length },
  });
  if (!result.ok || !result.copy) throw new Error('The existing display cache was not restored.');
  expect(t.copies.ready(t.sha)).toEqual(result.copy);
  expect(readFileSync(join(t.dir, result.copy.path))).toEqual(oldBytes);
  expect(readFileSync(join(t.dir, t.source))).toEqual(t.original);
  expect(t.open).not.toHaveBeenCalled();
  expect(t.saveBlob).not.toHaveBeenCalled();
});

it('keeps the existing failed result when the granted worker has no encoded Blob', async () => {
  const t = existingPicture();
  const prepared = t.copies.prepare({ path: t.source, sha256: t.sha });
  await vi.waitFor(() => expect(t.open).toHaveBeenCalledOnce());
  const job = await t.copies.next(1);
  if (!job) throw new Error('The empty-result job was not granted.');
  expect(await t.copies.made(1, job.key, null)).toBe(true);
  expect(await prepared).toEqual({ ok: false, message: 'The display copy could not be drawn.' });
  expect(t.copies.ready(t.sha)).toBeNull();
  expect(t.saveBlob).not.toHaveBeenCalled();
  expect(t.changed).not.toHaveBeenCalled();
  expect(readFileSync(join(t.dir, t.source))).toEqual(t.original);
});
