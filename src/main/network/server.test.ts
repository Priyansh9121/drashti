import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { EngineMessage } from '../../shared/engine/protocol';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import type { ToDevice } from '../../shared/network';
import type { DeviceAuth, DeviceRequest } from '../../shared/network-api';
import { NetworkServer, type ServerHost } from './server';
import { hashToken } from './tokens';

/*
 * The network server on this computer only, with a stand-in for the main
 * process, and made-up tokens.
 */

const REMOTE_TOKEN = 'test-made-up-remote-token-0000000000';
const STAGE_TOKEN = 'test-made-up-stage-token-00000000000';
const ANNOUNCE_TOKEN = 'test-made-up-announce-token-0000000';

const devices: DeviceAuth[] = [
  { id: 'd-remote', name: 'Placeholder phone', kind: 'remote', tokenHash: hashToken(REMOTE_TOKEN) },
  { id: 'd-stage', name: 'Placeholder tablet', kind: 'stage', tokenHash: hashToken(STAGE_TOKEN) },
  {
    id: 'd-announce',
    name: 'Placeholder poster',
    kind: 'announcements',
    tokenHash: hashToken(ANNOUNCE_TOKEN),
  },
];

let dir = '';
let server: NetworkServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

interface Fake extends ServerHost {
  requests: DeviceRequest[];
  connectedNow: string[];
  resyncs: number;
}

function fakeHost(): Fake {
  const host: Fake = {
    requests: [],
    connectedNow: [],
    resyncs: 0,
    request: (r) => {
      host.requests.push(r);
      return Promise.resolve({ status: 200, body: { ok: true, op: r.op } });
    },
    pair: (code) =>
      Promise.resolve(
        code === '123456'
          ? {
              ok: true as const,
              token: 'test-made-up-new-token-000000000000',
              device: {
                id: 'd-new',
                name: 'Placeholder new phone',
                kind: 'remote' as const,
                tokenHash: hashToken('test-made-up-new-token-000000000000'),
              },
            }
          : { ok: false as const, status: 403, message: 'That code is wrong or has expired.' },
      ),
    mediaSource: () => Promise.resolve(null),
    connected: (ids) => {
      host.connectedNow = ids;
    },
    seen: () => undefined,
    resync: () => {
      host.resyncs++;
    },
    log: () => undefined,
  };
  return host;
}

async function start(options: { refuseLoopback?: boolean } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'drashti-net-'));
  mkdirSync(join(dir, 'web', 'assets'), { recursive: true });
  writeFileSync(join(dir, 'web', 'pair.html'), '<!doctype html><title>pair</title>');
  writeFileSync(join(dir, 'web', 'remote.html'), '<!doctype html><title>remote</title>');
  writeFileSync(join(dir, 'web', 'assets', 'remote-abc.js'), 'console.log(1)');
  writeFileSync(join(dir, 'drashti.sqlite'), 'the library');
  const host = fakeHost();
  server = new NetworkServer(host);
  const started = await server.start({
    port: 0,
    bind: '127.0.0.1',
    webDir: join(dir, 'web'),
    ffmpeg: null,
    previewDir: join(dir, 'previews'),
    localName: null,
    refuseLoopback: options.refuseLoopback,
  });
  if (!started.ok) throw new Error(started.message);
  server.setDevices(devices);
  return { host, port: started.port, server };
}

function call(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: { Host: `127.0.0.1:${port}`, ...options.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

function feed(
  port: number,
  headers: Record<string, string> = {},
): Promise<{ ws: WebSocket; messages: ToDevice[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/feed`, { headers });
    const messages: ToDevice[] = [];
    ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString('utf8')) as ToDevice));
    ws.on('open', () => {
      resolve({ ws, messages });
    });
    ws.on('error', reject);
  });
}

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

const snapshot = (rev: number): EngineMessage => ({
  kind: 'snapshot',
  version: ENGINE_STATE_VERSION,
  rev,
  state: initialEngineState(),
  sentAt: Date.now(),
});

describe('the network server', () => {
  it('serves the pages, and nothing by a path that escapes', async () => {
    const { port } = await start();
    const page = await call(port, '/remote');
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toContain(`connect-src 'self' ws://127.0.0.1:${port}`);
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect((await call(port, '/assets/remote-abc.js')).headers['cache-control']).toContain('immutable');
    expect((await call(port, '/')).body).toContain('pair');
    for (const path of [
      '/../drashti.sqlite',
      '/assets/../../drashti.sqlite',
      '/assets/%2e%2e/%2e%2e/drashti.sqlite',
      '/assets/..%2f..%2fdrashti.sqlite',
      '/%2e%2e/drashti.sqlite',
    ]) {
      const r = await call(port, path);
      expect(r.status, path).toBe(400);
      expect(r.body).not.toContain('the library');
    }
    expect((await call(port, '/drashti.sqlite')).status).toBe(404);
    expect((await call(port, '/index.html')).status).toBe(404);
  });

  it('refuses a foreign Host, a foreign Origin, and addresses outside the local network', async () => {
    const { port } = await start();
    expect((await call(port, '/remote', { headers: { Host: `attacker.example:${port}` } })).status).toBe(421);
    expect((await call(port, '/remote', { headers: { Host: '127.0.0.1:1' } })).status).toBe(421);
    expect(
      (
        await call(port, '/api/v1/me', {
          headers: { ...bearer(REMOTE_TOKEN), Origin: 'http://attacker.example' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(port, '/api/v1/me', {
          headers: { ...bearer(REMOTE_TOKEN), Origin: `http://127.0.0.1:${port}` },
        })
      ).status,
    ).toBe(200);
    await expect(feed(port, { Origin: 'http://attacker.example' })).rejects.toThrow(/403/u);
    await expect(feed(port, { Host: `attacker.example:${port}` })).rejects.toThrow(/421/u);
    await server?.stop();
    const outside = await start({ refuseLoopback: true });
    const refused = await call(outside.port, '/remote');
    expect(refused.status).toBe(403);
    expect(refused.body).toContain('Only devices on this local network');
    await expect(feed(outside.port)).rejects.toThrow(/403/u);
  });

  it('needs a token for anything with data, and lets each kind of device do only its own things', async () => {
    const { port, host } = await start();
    const none = await call(port, '/api/v1/me');
    expect(none.status).toBe(401);
    expect(none.headers['www-authenticate']).toBe('Bearer');
    expect(
      (await call(port, '/api/v1/me', { headers: bearer('test-made-up-wrong-token-000000000') })).status,
    ).toBe(401);
    expect(JSON.parse((await call(port, '/api/v1/me', { headers: bearer(STAGE_TOKEN) })).body)).toMatchObject(
      {
        device: { kind: 'stage', name: 'Placeholder tablet' },
      },
    );
    // Stage watches; it cannot run the show or read playlists. Announcements only submits.
    expect(
      (await call(port, '/api/v1/trigger/next', { method: 'POST', headers: bearer(STAGE_TOKEN) })).status,
    ).toBe(403);
    expect((await call(port, '/api/v1/playlists', { headers: bearer(STAGE_TOKEN) })).status).toBe(403);
    expect((await call(port, '/api/v1/state', { headers: bearer(ANNOUNCE_TOKEN) })).status).toBe(403);
    expect(
      (await call(port, '/api/v1/trigger/next', { method: 'POST', headers: bearer(ANNOUNCE_TOKEN) })).status,
    ).toBe(403);
    // The remote's request reaches the main process as an op with its arguments.
    const next = await call(port, '/api/v1/trigger/next', { method: 'POST', headers: bearer(REMOTE_TOKEN) });
    expect(next.status).toBe(200);
    expect(host.requests.at(-1)).toEqual({ deviceId: 'd-remote', op: 'command', args: { type: 'next' } });
    await call(port, '/api/v1/trigger/slide', {
      method: 'POST',
      headers: { ...bearer(REMOTE_TOKEN), 'Content-Type': 'application/json' },
      body: JSON.stringify({ presentationId: 'p1', slideIndex: 2, type: 'clearAll' }),
    });
    expect(host.requests.at(-1)?.args).toEqual({ presentationId: 'p1', slideIndex: 2, type: 'goLive' });
    expect((await call(port, '/api/v1/trigger/next', { headers: bearer(REMOTE_TOKEN) })).status).toBe(405);
    expect((await call(port, '/api/v1/nothing', { headers: bearer(REMOTE_TOKEN) })).status).toBe(404);
    expect(
      (await call(port, '/api/v1/timers/..%2f/start', { method: 'POST', headers: bearer(REMOTE_TOKEN) }))
        .status,
    ).toBe(400);
    const big = await call(port, '/api/v1/announcements', {
      method: 'POST',
      headers: { ...bearer(ANNOUNCE_TOKEN), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(20_000) }),
    });
    expect(big.status).toBe(413);
  });

  it('pairs with the right code, and refuses an address after five wrong ones', async () => {
    const { port } = await start();
    const pair = (code: string) =>
      call(port, '/api/v1/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
    const ok = await pair('123 456');
    expect(ok.status).toBe(200);
    const token = (JSON.parse(ok.body) as { token: string }).token;
    expect((await call(port, '/api/v1/me', { headers: bearer(token) })).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await pair('000000')).status).toBe(403);
    // The sixth try in the minute is refused, even with the right code.
    expect((await pair('123456')).status).toBe(429);
  });

  it('sends the whole state, then each change; answers the clock; cuts off a removed device at once', async () => {
    const { port, server: s, host } = await start();
    s.engine(snapshot(5));
    const { ws, messages } = await feed(port);
    ws.send(JSON.stringify({ type: 'hello', token: REMOTE_TOKEN }));
    await until(() => messages.some((m) => m.type === 'engine'));
    expect(messages[0]).toEqual({ type: 'welcome', device: { name: 'Placeholder phone', kind: 'remote' } });
    expect(messages[1]).toMatchObject({ type: 'engine', message: { kind: 'snapshot', rev: 5 } });
    await until(() => host.connectedNow.includes('d-remote'));
    s.engine({
      kind: 'patch',
      version: ENGINE_STATE_VERSION,
      baseRev: 5,
      rev: 6,
      ops: [{ path: ['blackout'], value: true }],
      sentAt: Date.now(),
    });
    await until(() => messages.length === 3);
    expect(messages[2]).toMatchObject({ type: 'engine', message: { kind: 'patch', rev: 6 } });
    // A patch that does not follow on asks the main process for a fresh snapshot.
    s.engine({
      kind: 'patch',
      version: ENGINE_STATE_VERSION,
      baseRev: 9,
      rev: 10,
      ops: [],
      sentAt: Date.now(),
    });
    expect(host.resyncs).toBe(1);
    const t0 = Date.now();
    ws.send(JSON.stringify({ type: 'clock', t0 }));
    await until(() => messages.some((m) => m.type === 'clock'));
    const clock = messages.find((m) => m.type === 'clock');
    expect(clock).toMatchObject({ type: 'clock', t0 });
    expect(Math.abs((clock?.type === 'clock' ? clock.server : 0) - Date.now())).toBeLessThan(1000);
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    s.setDevices(devices.filter((d) => d.id !== 'd-remote'));
    expect(await closed).toBe(4000);
    expect(messages.at(-1)).toEqual({ type: 'bye', reason: 'revoked' });
    await until(() => host.connectedNow.length === 0);
  });

  it('closes a feed that does not say hello with a token, and one from a device that may not watch', async () => {
    const { port } = await start();
    const bad = await feed(port);
    bad.ws.send(JSON.stringify({ type: 'hello', token: 'test-made-up-wrong-token-000000000' }));
    await until(() => bad.messages.some((m) => m.type === 'bye'));
    expect(bad.messages.at(-1)).toEqual({ type: 'bye', reason: 'unauthorized' });
    const poster = await feed(port);
    poster.ws.send(JSON.stringify({ type: 'hello', token: ANNOUNCE_TOKEN }));
    await until(() => poster.messages.some((m) => m.type === 'bye'));
    expect(poster.messages.at(-1)).toEqual({ type: 'bye', reason: 'not-allowed' });
  });
});
