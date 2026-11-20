import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { streamLinkUrl } from '../../shared/live-link';
import { handleMediaRequest, mediaRequestOf, type MediaProtocolDeps } from './media-protocol';

/*
 * A stream link's local stream through drashti-media://live/<id>/ (alpha.20, the playback set's slice 8): its playlist
 * and numbered segments, from its own folder, only while that link is connecting or up, never kept by the page.
 */

const ID = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
let root: string;
let deps: MediaProtocolDeps;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'drashti-live-'));
  const dir = join(root, ID);
  mkdirSync(dir);
  writeFileSync(join(dir, 'index.m3u8'), '#EXTM3U\n#EXTINF:1.0,\nseg-000001.ts\n');
  writeFileSync(join(dir, 'seg-000001.ts'), Uint8Array.from([0x47, 1, 2, 3]));
  writeFileSync(join(dir, 'seg-000002.ts.tmp'), Uint8Array.from([0x47]));
  writeFileSync(join(root, 'secret.txt'), 'not a stream');
  deps = {
    mediaDir: join(root, 'Media'),
    lookup: () => null,
    liveFolder: (linkId) => (linkId === ID ? dir : null),
    livePlaylist: (linkId, segment) =>
      Promise.resolve(linkId === ID ? `#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:${String(segment)}\n` : null),
  };
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const get = (url: string) => handleMediaRequest(new Request(url), deps);

describe('a stream link’s local stream through drashti-media://', () => {
  it('serves its playlist as a player joined at a segment is given it, and its segments, typed, never to be kept', async () => {
    const playlist = await get(streamLinkUrl(ID, 41));
    expect(playlist.status).toBe(200);
    expect(playlist.headers.get('Content-Type')).toBe('application/vnd.apple.mpegurl');
    expect(playlist.headers.get('Cache-Control')).toBe('no-store');
    expect(await playlist.text()).toContain('#EXT-X-MEDIA-SEQUENCE:41');
    const segment = await get(`drashti-media://live/${ID}/41/seg-000001.ts`);
    expect(segment.status).toBe(200);
    expect(segment.headers.get('Content-Type')).toBe('video/mp2t');
    expect(segment.headers.get('Cache-Control')).toBe('no-store');
    expect(new Uint8Array(await segment.arrayBuffer())).toEqual(Uint8Array.from([0x47, 1, 2, 3]));
  });

  it('serves nothing of a link that is not up, a segment still being written, or anything else in or beside its folder', async () => {
    expect((await get(streamLinkUrl(OTHER, 1))).status).toBe(404);
    for (const url of [
      `drashti-media://live/${ID}/1/seg-000002.ts.tmp`,
      `drashti-media://live/${ID}/1/seg-000009.ts`,
      `drashti-media://live/${ID}/1/../../secret.txt`,
      `drashti-media://live/${ID}/1/%2e%2e/secret.txt`,
      `drashti-media://live/${ID}/1/other.m3u8`,
      `drashti-media://live/${ID}/seg-000001.ts`,
      'drashti-media://live/not-an-id/1/index.m3u8',
    ])
      expect((await get(url)).status, url).toBe(404);
  });

  it('reads only the addresses Drashti makes for it', () => {
    expect(mediaRequestOf(streamLinkUrl(ID, 7))).toEqual({
      what: 'live',
      linkId: ID,
      segment: 7,
      name: 'index.m3u8',
    });
    expect(mediaRequestOf(`drashti-media://live/${ID}/7/seg-123456.ts`)).toEqual({
      what: 'live',
      linkId: ID,
      segment: 7,
      name: 'seg-123456.ts',
    });
    expect(mediaRequestOf(`drashti-media://live/${ID}/7/seg-12345.ts`)).toBeNull();
    expect(mediaRequestOf(`drashti-media://live/${ID}/x/index.m3u8`)).toBeNull();
    // Drashti's ids are lower case.
    expect(
      mediaRequestOf('drashti-media://live/ABCDEF00-0000-4000-8000-000000000001/7/index.m3u8'),
    ).toBeNull();
  });
});
