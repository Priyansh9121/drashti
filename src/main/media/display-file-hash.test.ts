import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { MAX_DISPLAY_COPY_BYTES } from '../../shared/pictures';
import { hashDisplayFile } from './display-file-hash';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-display-hash-'));
  dirs.push(dir);
  const path = join(dir, 'generated.blob');
  const bytes = Buffer.alloc(2 * 64 * 1024 + 17);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (Math.imul(i, 29) + 7) & 255;
  writeFileSync(path, bytes);
  return { path, bytes };
}

it('checks every encoded byte, including the final partial read, without changing the file', async () => {
  const t = fixture();
  const hash = await hashDisplayFile(t.path, t.bytes.length, new AbortController().signal);
  expect(hash).toBe(createHash('sha256').update(t.bytes).digest('hex'));
  expect(readFileSync(t.path)).toEqual(t.bytes);
});

it.each([-1, 1])('refuses a file whose actual size differs by %s byte', async (difference) => {
  const t = fixture();
  await expect(
    hashDisplayFile(t.path, t.bytes.length + difference, new AbortController().signal),
  ).rejects.toThrow();
  expect(readFileSync(t.path)).toEqual(t.bytes);
});

it('refuses a cancelled check and keeps the encoded file unchanged', async () => {
  const t = fixture();
  const abort = new AbortController();
  abort.abort();
  await expect(hashDisplayFile(t.path, t.bytes.length, abort.signal)).rejects.toThrow();
  expect(readFileSync(t.path)).toEqual(t.bytes);
});

it('rejects an oversized declaration before opening its file', async () => {
  await expect(
    hashDisplayFile('not-opened', MAX_DISPLAY_COPY_BYTES + 1, new AbortController().signal),
  ).rejects.toThrow();
});
