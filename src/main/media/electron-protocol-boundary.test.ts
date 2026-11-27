import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleMediaRequest, mediaRequestOf, type MediaProtocolDeps } from './media-protocol';
import { handleDisplaySourceRequest } from './display-worker-source';

let root: string;
let mediaDir: string;
let guides: string;
let live: string;
const bytes = Uint8Array.from([11, 22, 33, 44, 55]);
const sha256 = 'ab'.repeat(32);
const link = '12345678-1234-1234-1234-123456789abc';
const key = `p1-${'ab'.repeat(16)}-800x600`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'drashti-protocol-boundary-'));
  mediaDir = join(root, 'media');
  guides = join(root, 'guides');
  live = join(root, 'live');
  for (const dir of [mediaDir, guides, live, join(root, 'outside')]) mkdirSync(dir);
  for (const dir of [mediaDir, guides, live, join(root, 'outside')]) {
    writeFileSync(join(dir, 'placeholder.png'), bytes);
  }
  writeFileSync(join(root, 'outside', 'seg-000001.ts'), bytes);
  // Directory junctions work without Windows' file-symlink privilege; never skip this boundary there.
  symlinkSync(join(root, 'outside'), join(mediaDir, 'escape'), 'junction');
  symlinkSync(join(root, 'outside'), join(guides, 'escape'), 'junction');
  symlinkSync(join(root, 'outside'), join(live, 'escape'), 'junction');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const deps = (path = 'placeholder.png'): MediaProtocolDeps => ({
  mediaDir,
  lookup: (id) => (id === 'placeholder' ? { path, sha256, missing: false } : null),
});
const response = (url: string, rules: MediaProtocolDeps, init?: RequestInit) =>
  handleMediaRequest(new Request(url, init), rules);

describe('custom scheme routes cannot select arbitrary filesystem paths', () => {
  it.each([
    '..%2Foutside%2Fplaceholder.png',
    '..%5Coutside%5Cplaceholder.png',
    '%2e%2e%2fplaceholder.png',
    'placeholder%00.png',
    'placeholder/extra',
    'C:%5Coutside%5Cplaceholder.png',
    '%252e%252e%252fplaceholder.png',
  ])('refuses path-shaped IDs: %s', async (id) => {
    const url = `drashti-media://media/${id}`;
    expect(mediaRequestOf(url)).toBeNull();
    expect((await response(url, deps())).status).toBe(404);
  });

  it.each(['../outside/placeholder.png', '..\\outside\\placeholder.png', 'escape/placeholder.png'])(
    'contains library metadata by real path: %s',
    async (path) => {
      expect((await response('drashti-media://media/placeholder', deps(path))).status).toBe(404);
      let fetched = false;
      const privateResponse = await handleDisplaySourceRequest(
        new Request('drashti-media://media/placeholder'),
        {
          ...deps(path),
          fetchFile: () => {
            fetched = true;
            return Promise.resolve(new Response(bytes));
          },
        },
      );
      expect(privateResponse.status).toBe(404);
      expect(fetched).toBe(false);
    },
  );

  it('refuses absolute metadata and escaping display copies', async () => {
    expect(
      (await response('drashti-media://media/placeholder', deps(join(root, 'outside', 'placeholder.png'))))
        .status,
    ).toBe(404);
    expect(
      (
        await response(`drashti-media://display/placeholder/${key}`, {
          ...deps(),
          display: () => 'escape/placeholder.png',
        })
      ).status,
    ).toBe(404);
  });

  it('keeps guide, opening and live files inside their separate declared folders', async () => {
    const wrong = join(root, 'outside', 'placeholder.png');
    expect(
      (
        await response('drashti-media://guide/placeholder.png', {
          ...deps(),
          guidePicture: () => ({ dir: guides, file: wrong }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await response('drashti-media://opening-default/photo', {
          ...deps(),
          openingPhoto: () => ({ dir: guides, file: join(guides, 'escape', 'placeholder.png') }),
        })
      ).status,
    ).toBe(404);
    expect(mediaRequestOf(`drashti-media://live/${link}/1/..%2Fplaceholder.png`)).toBeNull();
    expect(
      (
        await response(`drashti-media://live/${link}/1/seg-000001.ts`, {
          ...deps(),
          liveFolder: () => live,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await response('drashti-media://guide/placeholder.png', {
          ...deps(),
          guidePicture: () => ({ dir: guides, file: join(guides, 'placeholder.png') }),
        })
      ).status,
    ).toBe(200);
  });

  it('retains legitimate retry queries, byte ranges and HEAD without exposing another file', async () => {
    const url = 'drashti-media://media/placeholder?try=2';
    const whole = await response(url, deps());
    expect(whole.status).toBe(200);
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(bytes);
    const part = await response(url, deps(), { headers: { Range: 'bytes=1-3' } });
    expect(part.status).toBe(206);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.subarray(1, 4));
    const head = await response(url, deps(), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Length')).toBe(String(bytes.length));
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    expect((await response(url, deps(), { method: 'POST' })).status).toBe(405);
  });
});
