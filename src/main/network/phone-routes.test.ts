import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceAuth, DeviceRequest } from '../../shared/network-api';
import { API_ROUTES, NetworkServer, type ServerHost } from './server';
import { hashToken } from './tokens';

/*
 * The phone's own requests (Session 55, Part 9) as the network server takes them: each reaches the main process as its
 * op with its arguments (the id from its path), from a Remote only, never a Stage device or the announcements poster.
 * On this computer only, with a stand-in for the main process; made-up tokens and placeholder ids.
 */

const REMOTE_TOKEN = 'test-made-up-remote-token-phone-0000';
const STAGE_TOKEN = 'test-made-up-stage-token-phone-00000';
const POSTER_TOKEN = 'test-made-up-poster-token-phone-0000';

const devices: DeviceAuth[] = [
  { id: 'd-remote', name: 'Placeholder phone', kind: 'remote', tokenHash: hashToken(REMOTE_TOKEN) },
  { id: 'd-stage', name: 'Placeholder tablet', kind: 'stage', tokenHash: hashToken(STAGE_TOKEN) },
  { id: 'd-poster', name: 'Announcements poster', kind: 'announcements', tokenHash: hashToken(POSTER_TOKEN) },
];

let dir = '';
let server: NetworkServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function start() {
  dir = mkdtempSync(join(tmpdir(), 'drashti-phone-routes-'));
  mkdirSync(join(dir, 'web', 'assets'), { recursive: true });
  writeFileSync(join(dir, 'web', 'remote.html'), '<!doctype html><title>remote</title>');
  const requests: DeviceRequest[] = [];
  const host: ServerHost = {
    request: (r) => {
      requests.push(r);
      return Promise.resolve({ status: 200, body: { ok: true } });
    },
    pair: () => Promise.resolve({ ok: false, status: 403, message: 'No.' }),
    mediaSource: () => Promise.resolve(null),
    connected: () => undefined,
    seen: () => undefined,
    resync: () => undefined,
    log: () => undefined,
  };
  server = new NetworkServer(host);
  server.setLetIn(true);
  const started = await server.start({
    port: 0,
    bind: '127.0.0.1',
    webDir: join(dir, 'web'),
    ffmpeg: null,
    previewDir: join(dir, 'previews'),
    localName: null,
  });
  if (!started.ok) throw new Error(started.message);
  server.setDevices(devices);
  return { port: started.port, requests };
}

function call(port: number, path: string, token: string, method = 'GET', body?: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Host: `127.0.0.1:${port}`,
          Authorization: `Bearer ${token}`,
          ...(text ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          resolve(res.statusCode ?? 0);
        });
      },
    );
    req.on('error', reject);
    if (text) req.write(text);
    req.end();
  });
}

const PIN = { kind: 'media', mediaId: 'm-1', media: 'image', label: 'Placeholder backdrop' };

/** Each request, and what the main process is asked: the op and its arguments. */
const ASKED: [method: string, path: string, body: unknown, op: string, args: unknown][] = [
  ['GET', '/api/v1/wallpapers', undefined, 'wallpapers', {}],
  ['POST', '/api/v1/wallpapers/choose', { wallpaperId: 'w-1' }, 'wallpaper.choose', { wallpaperId: 'w-1' }],
  ['POST', '/api/v1/wallpapers/choose', { wallpaperId: null }, 'wallpaper.choose', { wallpaperId: null }],
  // The id from the path, whatever the body says.
  [
    'POST',
    '/api/v1/wallpapers/w-1/rename',
    { name: 'Placeholder dusk', wallpaperId: 'w-2' },
    'wallpaper.rename',
    { name: 'Placeholder dusk', wallpaperId: 'w-1' },
  ],
  ['POST', '/api/v1/wallpapers/w-1/delete', undefined, 'wallpaper.remove', { wallpaperId: 'w-1' }],
  ['POST', '/api/v1/wallpapers/w-1/restore', undefined, 'wallpaper.restore', { wallpaperId: 'w-1' }],
  ['GET', '/api/v1/quick-bar', undefined, 'quickBar', {}],
  ['POST', '/api/v1/quick-bar', { pins: [PIN] }, 'quickBar.set', { pins: [PIN] }],
  ['GET', '/api/v1/media/m-1/look', undefined, 'media.look', { mediaId: 'm-1' }],
  [
    'POST',
    '/api/v1/media/m-1/look',
    { look: null, mediaId: 'm-2' },
    'media.setLook',
    { look: null, mediaId: 'm-1' },
  ],
  [
    'POST',
    '/api/v1/media/m-1/rename',
    { name: 'Placeholder dawn' },
    'media.rename',
    { name: 'Placeholder dawn', mediaId: 'm-1' },
  ],
  [
    'POST',
    '/api/v1/presentations/p-1/rename',
    { name: 'Placeholder talk' },
    'presentation.rename',
    { name: 'Placeholder talk', presentationId: 'p-1' },
  ],
  [
    'POST',
    '/api/v1/playlist-items/i-1/when-ends',
    { whenEnds: 'loop' },
    'playlist.whenEnds',
    { whenEnds: 'loop', itemId: 'i-1' },
  ],
];

/** The paths a GET also answers (a read beside its change). */
const READ_TOO = new Set(['/api/v1/quick-bar', '/api/v1/media/m-1/look']);

describe('the phone’s own requests (Session 55, Part 9)', () => {
  it('reach the main process as their ops with their arguments, the id from the path', async () => {
    const { port, requests } = await start();
    for (const [method, path, body, op, args] of ASKED) {
      expect(await call(port, path, REMOTE_TOKEN, method, body), path).toBe(200);
      expect(requests.at(-1), path).toEqual({ deviceId: 'd-remote', op, args, address: '127.0.0.1' });
    }
  });

  it('are refused to a Stage device and to the announcements poster, and changes are taken only by POST', async () => {
    const { port, requests } = await start();
    for (const [method, path, body] of ASKED) {
      expect(await call(port, path, STAGE_TOKEN, method, body), path).toBe(403);
      expect(await call(port, path, POSTER_TOKEN, method, body), path).toBe(403);
      if (method === 'POST' && !READ_TOO.has(path))
        expect(await call(port, path, REMOTE_TOKEN, 'GET'), path).toBe(405);
    }
    expect(requests).toEqual([]);
  });

  it('are each in the API’s list, which the documentation is checked against', () => {
    for (const [method, path] of ASKED) {
      const route = `${method} ${path}`.replace(/\/(w-1|m-1|p-1|i-1)\//u, '/:id/');
      expect(API_ROUTES, route).toContain(route);
    }
  });
});
