import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MediaCache } from './media-cache';

describe('a controller’s next-video still', () => {
  it('uses only the hash of a file already copied here, and refuses missing or changed copies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-controller-media-'));
    const sha256 = 'a'.repeat(64);
    const mediaId = 'placeholder-video';
    writeFileSync(join(dir, `${sha256}.webm`), Buffer.alloc(4));
    writeFileSync(
      join(dir, 'index.json'),
      JSON.stringify({
        files: { [sha256]: { ext: 'webm', bytes: 4, wantedAt: 0 } },
        ids: { [mediaId]: { sha256, ext: 'webm', bytes: 4 } },
      }),
    );
    const cache = new MediaCache({
      dir,
      open: () => Promise.reject(new Error('Not connected')),
      online: () => false,
      inUse: () => [],
      changed: () => undefined,
      landed: () => undefined,
      log: () => undefined,
    });
    try {
      expect(cache.hashFor(mediaId)).toBe(sha256);
      expect(cache.hashFor('not-copied')).toBeNull();
      cache.setWanted([{ id: mediaId, sha256: 'b'.repeat(64), ext: 'webm', bytes: 4 }]);
      expect(cache.hashFor(mediaId)).toBeNull();
    } finally {
      await cache.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
