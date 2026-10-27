import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { STOPPED_REFUSAL } from '../../shared/access';
import type { DeviceAuth, DeviceRequest } from '../../shared/network-api';
import { API_ROUTES, NetworkServer, type ServerHost } from './server';
import { hashToken } from './tokens';

/*
 * The phone as a full Drashti (Session 54, the owner's item 3) as the network server takes it: each request reaches
 * the main process as its op with its arguments, the ids from its path winning over its body's, from a Remote
 * only, by POST where it changes something, and nothing at all while Drashti is not let in. On this computer only,
 * with a stand-in for the main process; made-up tokens.
 */

const REMOTE_TOKEN = 'test-made-up-remote-token-desktop-00';
const STAGE_TOKEN = 'test-made-up-stage-token-desktop-000';
const POSTER_TOKEN = 'test-made-up-poster-token-desktop-00';

const devices: DeviceAuth[] = [
  { id: 'd-remote', name: 'Placeholder phone', kind: 'remote', tokenHash: hashToken(REMOTE_TOKEN) },
  { id: 'd-stage', name: 'Placeholder tablet', kind: 'stage', tokenHash: hashToken(STAGE_TOKEN) },
  { id: 'd-poster', name: 'Placeholder poster', kind: 'announcements', tokenHash: hashToken(POSTER_TOKEN) },
];

let dir = '';
let server: NetworkServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function start() {
  dir = mkdtempSync(join(tmpdir(), 'drashti-desktop-'));
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
  return { port: started.port, requests, server };
}

function call(
  port: number,
  path: string,
  token: string,
  method = 'GET',
  body?: unknown,
): Promise<{ status: number; body: string }> {
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
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
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
  ['GET', '/api/v1/screens', undefined, 'screens', {}],
  ['POST', '/api/v1/screens/keep', undefined, 'screens.keep', {}],
  ['POST', '/api/v1/screens/go-back', undefined, 'screens.goBack', {}],
  ['POST', '/api/v1/screens/identify', undefined, 'screens.identify', {}],
  [
    'POST',
    '/api/v1/screens/s-1/change',
    { enabled: false, canvasWidth: 1280 },
    'screens.change',
    { screenId: 's-1', patch: { enabled: false, canvasWidth: 1280 } },
  ],
  ['POST', '/api/v1/screens/s-1/remove', { screenId: 's-2' }, 'screens.remove', { screenId: 's-1' }],
  [
    'POST',
    '/api/v1/screen-groups',
    { name: 'Placeholder Hall' },
    'screens.addGroup',
    { name: 'Placeholder Hall' },
  ],
  [
    'POST',
    '/api/v1/screen-groups/g-1/name',
    { name: 'Placeholder Main Hall', groupId: 'g-2' },
    'screens.renameGroup',
    { name: 'Placeholder Main Hall', groupId: 'g-1' },
  ],
  [
    'POST',
    '/api/v1/screen-groups/g-1/role',
    { role: 'stage' },
    'screens.groupRole',
    { role: 'stage', groupId: 'g-1' },
  ],
  [
    'POST',
    '/api/v1/screen-groups/g-1/display',
    { displayId: 2 },
    'screens.useDisplay',
    { displayId: 2, groupId: 'g-1' },
  ],
  ['POST', '/api/v1/screen-groups/g-1/delete', undefined, 'screens.deleteGroup', { groupId: 'g-1' }],
  [
    'POST',
    '/api/v1/switches/audience',
    { on: false, confirmed: true, which: 'stage' },
    'switch',
    { on: false, confirmed: true, which: 'audience' },
  ],
  ['POST', '/api/v1/switches/stage', { on: true }, 'switch', { on: true, which: 'stage' }],
];

describe('the phone as a full Drashti’s requests (Session 54)', () => {
  it('reach the main process as their ops with their arguments, the path’s ids first, from a Remote', async () => {
    const { port, requests } = await start();
    for (const [method, path, body, op, args] of ASKED) {
      expect((await call(port, path, REMOTE_TOKEN, method, body)).status, path).toBe(200);
      expect(requests.at(-1), path).toEqual({ deviceId: 'd-remote', op, args, address: '127.0.0.1' });
    }
  });

  it('are refused to a Stage or Announcements device, and changes taken only by POST', async () => {
    const { port, requests } = await start();
    for (const [method, path] of ASKED) {
      expect((await call(port, path, STAGE_TOKEN, method)).status, path).toBe(403);
      expect((await call(port, path, POSTER_TOKEN, method)).status, path).toBe(403);
      if (method === 'POST') expect((await call(port, path, REMOTE_TOKEN, 'GET')).status, path).toBe(405);
    }
    // Only Audience and Stage are switches.
    expect(
      (await call(port, '/api/v1/switches/everything', REMOTE_TOKEN, 'POST', { on: false })).status,
    ).toBe(404);
    expect(requests).toEqual([]);
  });

  it('are refused, every one, while Drashti is not let in, and nothing reaches the main process', async () => {
    const { port, requests, server: s } = await start();
    s.setLetIn(false);
    for (const [method, path, body] of ASKED) {
      const answer = await call(port, path, REMOTE_TOKEN, method, body);
      expect(answer.status, path).toBe(503);
      expect(JSON.parse(answer.body), path).toEqual({ ok: false, message: STOPPED_REFUSAL });
    }
    expect(requests).toEqual([]);
  });

  it('are each in the API’s list, which the documentation is checked against', () => {
    for (const [method, path] of ASKED) {
      const route = `${method} ${path}`
        .replace(/\/(s-1|g-1)\//u, '/:id/')
        .replace(/\/(audience|stage)$/u, '/:id');
      expect(API_ROUTES, route).toContain(route);
    }
  });
});
