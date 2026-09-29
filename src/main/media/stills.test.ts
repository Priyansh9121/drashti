import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STILL_MAX_BYTES } from '../../shared/media';
import { stillPath } from './media-protocol';
import { isJpeg, saveStill } from './stills';

let dir: string;
const SHA = '0f'.repeat(32);
const jpeg = (size = 16) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  b.set([0xff, 0xd9], size - 2);
  return b;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-stills-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('still frames', () => {
  it('keeps a JPEG under the file sha256, replacing an older one', async () => {
    expect(await saveStill(dir, SHA, jpeg())).toEqual({ ok: true });
    expect(new Uint8Array(readFileSync(join(dir, stillPath(SHA))))).toEqual(jpeg());
    expect(await saveStill(dir, SHA, jpeg(32))).toEqual({ ok: true });
    expect(readFileSync(join(dir, stillPath(SHA)))).toHaveLength(32);
    // No partial files are left behind.
    expect(readdirSync(join(dir, 'stills'))).toEqual([`${SHA}.jpg`]);
  });

  it('refuses anything that is not one whole JPEG of a sensible size, or a name that is not a sha256', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const bytes of [
      png,
      jpeg().subarray(0, 10),
      'not bytes',
      null,
      [0xff, 0xd8],
      jpeg(STILL_MAX_BYTES + 2),
    ]) {
      expect(await saveStill(dir, SHA, bytes)).toMatchObject({ ok: false });
    }
    for (const sha of ['../../evil', 'AB'.repeat(32), '0f'.repeat(31), '']) {
      expect(await saveStill(dir, sha, jpeg())).toMatchObject({ ok: false });
    }
    expect(existsSync(join(dir, 'stills'))).toBe(false);
  });

  it('reports a folder it cannot write to', async () => {
    const file = join(dir, 'not-a-folder');
    writeFileSync(file, 'x');
    expect(await saveStill(file, SHA, jpeg())).toMatchObject({ ok: false });
  });

  it('recognises a JPEG by its first and last bytes', () => {
    expect(isJpeg(jpeg())).toBe(true);
    expect(isJpeg(jpeg().subarray(0, 3))).toBe(false);
  });
});
