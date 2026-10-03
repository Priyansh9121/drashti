import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { request } from 'node:http';
import { connect } from 'node:net';
import WebSocket from 'ws';
import type { NetworkStatus, ToDevice } from '../../src/shared/network';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { freePort } from './stream-helpers';

/*
 * The local network, end to end: the app's real server (on this computer
 * only, so no firewall asks), paired through the operator window's code.
 * Codes and tokens are made at run time and never printed.
 */

const NETWORK = { DRASHTI_TEST_NETWORK_LOCAL: '1' };

const net = (win: Page) => ({
  status: () => win.evaluate(() => (globalThis as PageGlobals).drashti.network.status()),
  setPort: (port: number) =>
    win.evaluate((p) => (globalThis as PageGlobals).drashti.network.setPort(p), port),
  setOn: (on: boolean) => win.evaluate((o) => (globalThis as PageGlobals).drashti.network.setOn(o), on),
  pairing: (kind: 'remote' | 'stage' | 'announcements', name: string) =>
    win.evaluate(
      async ({ kind, name }) => {
        const r = await (globalThis as PageGlobals).drashti.network.startPairing(kind, name);
        if (!r.ok || !r.status.pairing) throw new Error(r.ok ? 'no code' : r.message);
        return r.status.pairing.code;
      },
      { kind, name },
    ),
  revoke: (id: string) =>
    win.evaluate((d) => (globalThis as PageGlobals).drashti.network.revokeDevice(d), id),
});

/** Nothing answers on this port. */
const refused = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });

function call(port: number, path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  return new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: {
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            // Not JSON (a page).
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function workerRunning(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ app: a }) =>
    a.getAppMetrics().some((m) => m.type === 'Utility' && m.name === 'Drashti network'),
  );
}

test('off by default; on, a code pairs a device once, the feed follows the show, removing it cuts it off; off again, nothing listens', async () => {
  test.setTimeout(90_000);
  const port = await freePort();
  const { app } = await launchApp(NETWORK);
  const win = await operatorPage(app);
  await operatorReady(win);
  const n = net(win);

  // Off by default: no server process, nothing on the port.
  expect(await n.status()).toMatchObject({ on: false, state: 'off' });
  expect(await n.setPort(port)).toMatchObject({ ok: true });
  expect(await refused(port)).toBe(true);
  expect(await workerRunning(app)).toBe(false);

  expect(await n.setOn(true)).toMatchObject({ ok: true });
  await expect.poll(async () => (await n.status()).state).toBe('listening');
  expect(await workerRunning(app)).toBe(true);
  expect(await refused(port)).toBe(false);
  expect((await call(port, '/api/v1/me')).status).toBe(401);

  // A code from the operator window pairs one device, once.
  const code = await n.pairing('remote', 'Placeholder phone');
  const paired = await call(port, '/api/v1/pair', { method: 'POST', body: { code } });
  expect(paired.status).toBe(200);
  const token = String(paired.json['token']);
  expect((await call(port, '/api/v1/pair', { method: 'POST', body: { code } })).status).toBe(403);
  expect((await call(port, '/api/v1/me', { token })).json).toMatchObject({
    device: { name: 'Placeholder phone', kind: 'remote' },
  });
  const status: NetworkStatus = await n.status();
  expect(status.devices).toEqual([expect.objectContaining({ name: 'Placeholder phone', kind: 'remote' })]);
  expect(JSON.stringify(status.devices)).not.toContain(token);

  // The feed: the whole state, then each change the show makes.
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/feed`);
  const messages: ToDevice[] = [];
  ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString('utf8')) as ToDevice));
  await new Promise<void>((resolve) => ws.once('open', () => resolve()));
  ws.send(JSON.stringify({ type: 'hello', token }));
  await expect
    .poll(() => messages.some((m) => m.type === 'engine' && m.message.kind === 'snapshot'), {
      message: `the feed said ${JSON.stringify(messages.map((m) => m.type))}`,
    })
    .toBe(true);
  await expect.poll(async () => (await n.status()).connected).toBe(1);
  const next = await call(port, '/api/v1/blackout', { method: 'POST', token, body: { on: true } });
  expect(next.json).toMatchObject({ ok: true, changed: true });
  await expect
    .poll(() =>
      messages.some(
        (m) =>
          m.type === 'engine' &&
          m.message.kind === 'patch' &&
          JSON.stringify(m.message.ops).includes('blackout'),
      ),
    )
    .toBe(true);
  expect(
    await win.evaluate(
      async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.blackout,
    ),
  ).toBe(true);

  // Removing the device cuts its feed at once, and its token stops working.
  const closed = new Promise<number>((resolve) => ws.once('close', (c) => resolve(c)));
  await n.revoke(status.devices[0]?.id ?? '');
  expect(await closed).toBe(4000);
  expect(messages.at(-1)).toEqual({ type: 'bye', reason: 'revoked' });
  expect((await call(port, '/api/v1/me', { token })).status).toBe(401);

  // Off: nothing listens, and the server's process is gone.
  expect(await n.setOn(false)).toMatchObject({ ok: true });
  await expect.poll(() => refused(port)).toBe(true);
  await expect.poll(() => workerRunning(app)).toBe(false);
  await app.close();
});

test('only Pro Mode turns the network on or off or pairs devices', async () => {
  const { app } = await launchApp(NETWORK);
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  const n = net(win);
  expect(await n.setOn(true)).toMatchObject({ ok: false });
  expect((await n.status()).on).toBe(false);
  expect(
    await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.network.startPairing('remote', 'Placeholder'),
    ),
  ).toMatchObject({ ok: false });
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro'));
  await app.close();
});

/** A raw request with any Host and Origin (as a page elsewhere, or a rebinding name, would send). */
function raw(port: number, path: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

test('refused: a foreign Host or Origin, no token, paths that escape, and addresses outside the local network', async () => {
  test.setTimeout(90_000);
  const port = await freePort();
  const { app } = await launchApp(NETWORK);
  const win = await operatorPage(app);
  await operatorReady(win);
  const n = net(win);
  await n.setPort(port);
  await n.setOn(true);
  await expect.poll(async () => (await n.status()).state).toBe('listening');
  const host = `127.0.0.1:${port}`;
  expect(await raw(port, '/pair', { Host: host })).toBe(200);
  expect(await raw(port, '/pair', { Host: `attacker.example:${port}` })).toBe(421);
  expect(await raw(port, '/api/v1/me', { Host: host, Origin: 'http://attacker.example' })).toBe(403);
  expect(await raw(port, '/api/v1/state', { Host: host })).toBe(401);
  for (const path of [
    '/../drashti.sqlite',
    '/assets/%2e%2e/%2e%2e/drashti.sqlite',
    '/assets/..%2f..%2fdrashti.sqlite',
  ])
    expect(await raw(port, path, { Host: host }), path).toBe(400);
  expect(await raw(port, '/drashti.sqlite', { Host: host })).toBe(404);
  await app.close();

  // Treated as outside the local network (a test switch), this computer is turned away too.
  const outside = await launchApp({ ...NETWORK, DRASHTI_TEST_NETWORK_REFUSE_LOOPBACK: '1' });
  const win2 = await operatorPage(outside.app);
  await operatorReady(win2);
  const n2 = net(win2);
  await n2.setPort(port);
  await n2.setOn(true);
  await expect.poll(async () => (await n2.status()).state).toBe('listening');
  expect(await raw(port, '/pair', { Host: host })).toBe(403);
  await outside.app.close();
});

test('each kind of device may do only its own things', async () => {
  test.setTimeout(90_000);
  const port = await freePort();
  const { app } = await launchApp(NETWORK);
  const win = await operatorPage(app);
  await operatorReady(win);
  const n = net(win);
  await n.setPort(port);
  await n.setOn(true);
  await expect.poll(async () => (await n.status()).state).toBe('listening');
  const tokenFor = async (kind: 'remote' | 'stage' | 'announcements') => {
    const code = await n.pairing(kind, `Placeholder ${kind}`);
    const paired = await call(port, '/api/v1/pair', { method: 'POST', body: { code } });
    return String(paired.json['token']);
  };
  const remote = await tokenFor('remote');
  const stage = await tokenFor('stage');
  const poster = await tokenFor('announcements');
  // A Remote runs the show and reads its lists; a Stage device only watches; Announcements only sends.
  expect((await call(port, '/api/v1/trigger/next', { method: 'POST', token: remote })).status).not.toBe(403);
  expect((await call(port, '/api/v1/playlists', { token: remote })).status).toBe(200);
  expect((await call(port, '/api/v1/state', { token: stage })).status).toBe(200);
  expect((await call(port, '/api/v1/stage', { token: stage })).status).toBe(200);
  for (const [path, method] of [
    ['/api/v1/trigger/next', 'POST'],
    ['/api/v1/blackout', 'POST'],
    ['/api/v1/playlists', 'GET'],
  ] as const)
    expect((await call(port, path, { method, token: stage })).status, `stage ${path}`).toBe(403);
  for (const [path, method] of [
    ['/api/v1/state', 'GET'],
    ['/api/v1/trigger/next', 'POST'],
    ['/api/v1/messages', 'GET'],
  ] as const)
    expect((await call(port, path, { method, token: poster })).status, `announcements ${path}`).toBe(403);
  expect((await call(port, '/api/v1/stage', { token: remote })).status).toBe(403);
  await app.close();
});
