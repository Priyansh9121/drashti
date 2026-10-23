import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { EngineMirror } from '../../shared/engine/mirror';
import type { EngineMessage, EngineSnapshotMessage } from '../../shared/engine/protocol';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import type { ToDevice } from '../../shared/network';
import type { DeviceAuth, DeviceRequest } from '../../shared/network-api';
import { NetworkServer, type ServerHost, SOCKET_LIMITS } from './server';
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

async function start(
  options: { refuseLoopback?: boolean; sockets?: { total: number; perAddress: number } } = {},
) {
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
    ...(options.sockets ? { sockets: options.sockets } : {}),
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

/** A raw connection from this computer, and whether the server has closed it (a moment after connecting). */
function socketTo(port: number): Promise<{ socket: Socket; closed: () => boolean }> {
  return new Promise((resolve, reject) => {
    let closed = false;
    const socket = connect(port, '127.0.0.1', () => {
      resolve({ socket, closed: () => closed });
    });
    socket.on('close', () => {
      closed = true;
    });
    socket.on('error', () => {
      closed = true;
    });
    socket.once('error', reject);
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

describe('connections at once (Sessions 31–36, SEC-11)', () => {
  it('closes at once the one too many from an address', async () => {
    const { port } = await start({ sockets: { total: 50, perAddress: 3 } });
    const open = await Promise.all([socketTo(port), socketTo(port), socketTo(port)]);
    const extra = await socketTo(port);
    await settle();
    expect(open.map((o) => o.closed())).toEqual([false, false, false]);
    expect(extra.closed()).toBe(true);
    // One closed: room again.
    open[0].socket.destroy();
    await settle();
    const again = await socketTo(port);
    await settle();
    expect(again.closed()).toBe(false);
    for (const o of [...open, again]) o.socket.destroy();
  });

  it('closes at once the one too many in all', async () => {
    const { port } = await start({ sockets: { total: 2, perAddress: 50 } });
    const open = await Promise.all([socketTo(port), socketTo(port)]);
    const extra = await socketTo(port);
    await settle();
    expect(open.map((o) => o.closed())).toEqual([false, false]);
    expect(extra.closed()).toBe(true);
    for (const o of open) o.socket.destroy();
  });

  it('leaves room from one address for 10 feeds and a browser’s page fetches, and the Performance check’s 10 devices', () => {
    // A browser opens up to 6 connections to one address for pages; the Performance check's 10 devices, all
    // from this computer, each keep a feed open and fetch pages.
    expect(SOCKET_LIMITS.perAddress).toBeGreaterThan(10 + 6);
    expect(SOCKET_LIMITS.perAddress).toBeGreaterThanOrEqual(10 * 2);
    expect(SOCKET_LIMITS.total).toBeGreaterThan(100);
  });
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
    // With the address it came from (for the limit on announcements per phone).
    expect(host.requests.at(-1)).toEqual({
      deviceId: 'd-remote',
      op: 'command',
      args: { type: 'next' },
      address: '127.0.0.1',
    });
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
    // A Shastra passage plays like a presentation: its id (with "/" and "#") comes percent-encoded.
    const passage = 'shastra:pg/ppr#14-16';
    expect(
      (
        await call(port, `/api/v1/presentations/${encodeURIComponent(passage)}`, {
          headers: bearer(REMOTE_TOKEN),
        })
      ).status,
    ).toBe(200);
    expect(host.requests.at(-1)).toMatchObject({ op: 'presentation', args: { presentationId: passage } });
    // Only a passage's own shape, and never a dot segment.
    expect(
      (
        await call(port, `/api/v1/presentations/${encodeURIComponent('shastra:x/../y#1')}`, {
          headers: bearer(REMOTE_TOKEN),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(port, `/api/v1/presentations/${encodeURIComponent('shastra:x y#1')}`, {
          headers: bearer(REMOTE_TOKEN),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(port, `/api/v1/timers/${encodeURIComponent('shastra:pg#1')}/start`, {
          method: 'POST',
          headers: bearer(REMOTE_TOKEN),
        })
      ).status,
    ).toBe(404);
    // The presenter's remote (Session 18): the library a page at a time, and searched, by query string.
    expect(
      (await call(port, '/api/v1/presentations?offset=100&limit=50', { headers: bearer(REMOTE_TOKEN) }))
        .status,
    ).toBe(200);
    expect(host.requests.at(-1)).toMatchObject({
      op: 'presentations',
      args: { offset: '100', limit: '50' },
    });
    expect(
      (await call(port, '/api/v1/search?q=placeholder%20words', { headers: bearer(REMOTE_TOKEN) })).status,
    ).toBe(200);
    expect(host.requests.at(-1)).toMatchObject({ op: 'search', args: { query: 'placeholder words' } });
    expect((await call(port, '/api/v1/search?q=x', { headers: bearer(STAGE_TOKEN) })).status).toBe(403);
    expect(
      (await call(port, '/api/v1/presentations', { method: 'POST', headers: bearer(REMOTE_TOKEN) })).status,
    ).toBe(405);
    const big = await call(port, '/api/v1/announcements', {
      method: 'POST',
      headers: { ...bearer(ANNOUNCE_TOKEN), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(20_000) }),
    });
    expect(big.status).toBe(413);
  });

  // Session 51 (S4-4): a tablet's stage display draws the audience picture box from the same small previews as a
  // remote's live picture, under the same rules (a paired device's token, a media id); an announcements poster none.
  it('gives a stage display the same small previews as a remote, and an announcements poster none', async () => {
    const { port } = await start();
    const preview = (headers: Record<string, string>) =>
      call(port, '/api/v1/media/placeholder-media/preview', { headers });
    // The stand-in main process knows no media: past the device's kind, there is no such item.
    for (const token of [REMOTE_TOKEN, STAGE_TOKEN]) {
      const answer = await preview(bearer(token));
      expect(answer.status, token).toBe(404);
      expect(answer.body).toContain('There is no such media item.');
    }
    expect((await preview(bearer(ANNOUNCE_TOKEN))).status).toBe(403);
    expect((await preview({})).status).toBe(401);
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

  // Session 53: each run of the engine (Drashti started again after a crash or an update) counts its revisions from
  // 0 again. To a phone's or tablet's page left open over the restart, a snapshot that did not say its run was old
  // news: the page kept the last run's picture, and its Next, sent with the last run's revision, did nothing.
  it('says which run of the engine each snapshot is from: a page left open over a restart follows the new run', async () => {
    const { port, server: s, host } = await start();
    const run = (rev: number, session: string, blackout: boolean): EngineSnapshotMessage => ({
      kind: 'snapshot',
      version: ENGINE_STATE_VERSION,
      rev,
      state: { ...initialEngineState(), blackout },
      sentAt: Date.now(),
      session,
    });
    // The page's copy, as a phone keeps it (web/feed.ts, engine/engine-store.ts).
    const page = new EngineMirror();
    const follow = async () => {
      const f = await feed(port);
      f.ws.send(JSON.stringify({ type: 'hello', token: REMOTE_TOKEN }));
      await until(() => f.messages.some((m) => m.type === 'engine'));
      const first = f.messages.find((m) => m.type === 'engine');
      return { ...f, first, result: first?.type === 'engine' ? page.apply(first.message) : null };
    };
    s.engine(run(57, 'run-1', false));
    const before = await follow();
    expect(before.result).toBe('applied');
    before.ws.close();
    // Drashti starts again: the new run's state, a few revisions in; the page connects again by itself.
    s.engine(run(3, 'run-2', true));
    const after = await follow();
    expect(after.result).toBe('applied');
    expect({ rev: page.rev, session: page.session, blackout: page.state?.blackout }).toEqual({
      rev: 3,
      session: 'run-2',
      blackout: true,
    });
    expect(before.first).toMatchObject({ message: { kind: 'snapshot', rev: 57, session: 'run-1' } });
    expect(after.first).toMatchObject({ message: { kind: 'snapshot', rev: 3, session: 'run-2' } });
    // The whole state asked for again (a revision went missing) says its run too, and so does the API's state.
    after.ws.send(JSON.stringify({ type: 'resync' }));
    await until(() => after.messages.filter((m) => m.type === 'engine').length === 2);
    expect(after.messages.filter((m) => m.type === 'engine').at(-1)).toMatchObject({
      message: { kind: 'snapshot', rev: 3, session: 'run-2' },
    });
    const state = await call(port, '/api/v1/state', { headers: bearer(STAGE_TOKEN) });
    expect(JSON.parse(state.body)).toMatchObject({ ok: true, rev: 3, session: 'run-2' });
    // A phone's Next says the run it saw with the revision: both reach the main process.
    await call(port, '/api/v1/trigger/next', {
      method: 'POST',
      headers: { ...bearer(REMOTE_TOKEN), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rev: 3, session: 'run-2' }),
    });
    expect(host.requests.at(-1)?.args).toEqual({ type: 'next', rev: 3, session: 'run-2' });
    after.ws.close();
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
