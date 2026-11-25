import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mediaUrl, pageCopyUrl } from '../../shared/media';
import { handleMediaRequest, mediaRequestOf, type MediaProtocolDeps } from './media-protocol';

/*
 * drashti-media://page/<id>/<720|540> (QA23-FADE-9 candidate 1): a video's page copy, served only when it is ready for
 * that video's own bytes; nothing else under that name. Generated files.
 */

const SHA = 'a'.repeat(64);
let root: string;
let deps: MediaProtocolDeps;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'drashti-page-copy-protocol-'));
  mkdirSync(join(root, 'ab'), { recursive: true });
  mkdirSync(join(root, 'page-copies'), { recursive: true });
  writeFileSync(join(root, 'ab', 'red.webm'), 'placeholder original');
  writeFileSync(join(root, 'page-copies', `${SHA}-720p.webm`), 'placeholder copy');
  deps = {
    mediaDir: root,
    lookup: (id) => (id === 'red' ? { path: 'ab/red.webm', missing: false, sha256: SHA } : null),
    pageCopy: (sha, height) => (sha === SHA && height === 720 ? `page-copies/${SHA}-720p.webm` : null),
  };
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

it('reads a page copy’s address, and nothing else under that name', () => {
  expect(mediaRequestOf(pageCopyUrl('red', 720))).toEqual({ what: 'page', mediaId: 'red', height: 720 });
  expect(mediaRequestOf(pageCopyUrl('red', 540))).toEqual({ what: 'page', mediaId: 'red', height: 540 });
  for (const bad of [
    'drashti-media://page/red/480',
    'drashti-media://page/red',
    'drashti-media://page/red/720/x',
    'drashti-media://page/re%2Fd/720',
  ])
    expect(mediaRequestOf(bad), bad).toBeNull();
});

it('serves the copy that is ready, as a WebM, and 404 for one not made or a video not in the library', async () => {
  const res = await handleMediaRequest(new Request(pageCopyUrl('red', 720)), deps);
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toBe('video/webm');
  expect(await res.text()).toBe('placeholder copy');
  expect((await handleMediaRequest(new Request(pageCopyUrl('red', 540)), deps)).status).toBe(404);
  expect((await handleMediaRequest(new Request(pageCopyUrl('blue', 720)), deps)).status).toBe(404);
  const { pageCopy: _none, ...without } = deps;
  expect((await handleMediaRequest(new Request(pageCopyUrl('red', 720)), without)).status).toBe(404);
  // The original as ever.
  expect(await (await handleMediaRequest(new Request(mediaUrl('red')), deps)).text()).toBe(
    'placeholder original',
  );
});
