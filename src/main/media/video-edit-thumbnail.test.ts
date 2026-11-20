import { describe, expect, it } from 'vitest';
import { handleMediaRequest, type MediaProtocolDeps } from './media-protocol';

const jpeg = new Uint8Array([255, 216, 255, 217]);
const deps: MediaProtocolDeps & { selectedThumbnail(id: string): Uint8Array | null } = {
  mediaDir: '/placeholder/media',
  lookup: (id) => (id === 'video' ? { path: 'aa/source.mp4', missing: false, sha256: 'a'.repeat(64) } : null),
  selectedThumbnail: () => jpeg,
};

describe('a deliberately chosen library thumbnail', () => {
  it('serves the chosen immutable JPEG with safe image headers, without replacing the source or default still', async () => {
    const response = await handleMediaRequest(new Request('drashti-media://still/video'), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg);
  });
  it('never serves chosen bytes for an unknown or missing source; HEAD has no body', async () => {
    expect((await handleMediaRequest(new Request('drashti-media://still/unknown'), deps)).status).toBe(404);
    const missing = {
      ...deps,
      lookup: () => ({ path: 'aa/source.mp4', missing: true, sha256: 'a'.repeat(64) }),
    };
    expect((await handleMediaRequest(new Request('drashti-media://still/video'), missing)).status).toBe(404);
    const head = await handleMediaRequest(
      new Request('drashti-media://still/video', { method: 'HEAD' }),
      deps,
    );
    expect(head.status).toBe(200);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
  });
});
