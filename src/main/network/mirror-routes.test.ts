import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceAuth, DeviceRequest } from '../../shared/network-api';
import { API_ROUTES, NetworkServer, type ServerHost } from './server';
import { hashToken } from './tokens';

/*
 * The mirror's requests (Session 54, D5) as the network server takes them: each reaches the main process as its op
 * with its arguments, from a Remote only. On this computer only, with a stand-in for the main process; made-up
 * tokens.
 */

const REMOTE_TOKEN = 'test-made-up-remote-token-mirror-000';
const STAGE_TOKEN = 'test-made-up-stage-token-mirror-0000';

const devices: DeviceAuth[] = [
  { id: 'd-remote', name: 'Placeholder phone', kind: 'remote', tokenHash: hashToken(REMOTE_TOKEN) },
  { id: 'd-stage', name: 'Placeholder tablet', kind: 'stage', tokenHash: hashToken(STAGE_TOKEN) },
];

let dir = '';
let server: NetworkServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function start() {
  dir = mkdtempSync(join(tmpdir(), 'drashti-mirror-'));
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

/** Each request, and what the main process is asked: the op and its arguments. */
const ASKED: [method: string, path: string, body: unknown, op: string, args: unknown][] = [
  ['GET', '/api/v1/keys', undefined, 'keys', {}],
  ['GET', '/api/v1/props', undefined, 'props', {}],
  ['POST', '/api/v1/props/prop-1/show', undefined, 'prop.show', { propId: 'prop-1' }],
  ['POST', '/api/v1/props/prop-1/hide', undefined, 'command', { type: 'hideProp', propId: 'prop-1' }],
  [
    'GET',
    '/api/v1/media?offset=100&limit=50&q=placeholder%20words',
    undefined,
    'media',
    { offset: '100', limit: '50', query: 'placeholder words' },
  ],
  ['POST', '/api/v1/media/m-1/show', undefined, 'media.show', { mediaId: 'm-1' }],
  ['GET', '/api/v1/lower-thirds', undefined, 'lowerThirds', {}],
  ['POST', '/api/v1/lower-thirds/lt-1/show', undefined, 'lowerThird.show', { lowerThirdId: 'lt-1' }],
  ['POST', '/api/v1/lower-thirds/hide', undefined, 'command', { type: 'hideLowerThird' }],
  ['GET', '/api/v1/music', undefined, 'music', {}],
  ['POST', '/api/v1/music/play', { playlistId: 'music-1' }, 'music.play', { playlistId: 'music-1' }],
  ['POST', '/api/v1/music/play', undefined, 'music.play', {}],
  ['POST', '/api/v1/timers/t-1/show', undefined, 'command', { type: 'showTimer', timerId: 't-1' }],
  [
    'POST',
    '/api/v1/stage-message',
    { text: 'Placeholder: five minutes', type: 'clearAll' },
    'command',
    { type: 'setStageMessage', text: 'Placeholder: five minutes' },
  ],
  ['POST', '/api/v1/stage-message/clear', undefined, 'command', { type: 'clearStageMessage' }],
  [
    'POST',
    '/api/v1/skip',
    { layer: 'audio', jump: 'back', type: 'clearAll' },
    'command',
    { type: 'skip', layer: 'audio', jump: 'back' },
  ],
  ['POST', '/api/v1/idle/start', undefined, 'command', { type: 'startIdle' }],
  ['POST', '/api/v1/idle/stop', undefined, 'command', { type: 'stopIdle' }],
];

describe('the mirror’s requests (Session 54, D5)', () => {
  it('reach the main process as their ops with their arguments, from a Remote', async () => {
    const { port, requests } = await start();
    for (const [method, path, body, op, args] of ASKED) {
      expect(await call(port, path, REMOTE_TOKEN, method, body), path).toBe(200);
      expect(requests.at(-1), path).toEqual({ deviceId: 'd-remote', op, args, address: '127.0.0.1' });
    }
  });

  it('are refused to a Stage device, and actions taken only by POST', async () => {
    const { port, requests } = await start();
    for (const [method, path] of ASKED) {
      expect(await call(port, path, STAGE_TOKEN, method), path).toBe(403);
      if (method === 'POST') expect(await call(port, path, REMOTE_TOKEN, 'GET'), path).toBe(405);
    }
    expect(requests).toEqual([]);
  });

  it('are each in the API’s list, which the documentation is checked against', () => {
    for (const [method, path] of ASKED) {
      const route = `${method} ${path.split('?')[0] ?? ''}`.replace(/\/(prop-1|m-1|lt-1|t-1)\//u, '/:id/');
      expect(API_ROUTES, route).toContain(route);
    }
  });
});
