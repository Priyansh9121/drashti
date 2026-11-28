import { pairWithMain, LinkClient } from '../../src/main/node-mode/link-client';
import { NODE_PROTOCOL } from '../../src/shared/nodes';
import { ENGINE_STATE_VERSION } from '../../src/shared/engine/state';
import { launchMain, nodeCode, nodesStatus } from './nodes';
import { createServer, type RequestListener, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import WebSocket from 'ws';
import { networkOn, NETWORK_ENV, pairToken } from './devices';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';

async function server(handler: RequestListener): Promise<{ server: Server; base: string }> {
  const s = createServer(handler);
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  return { server: s, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
}
async function close(s: Server): Promise<void> {
  s.closeAllConnections();
  await new Promise<void>((resolve) => s.close(() => resolve()));
}
function feed(port: number): Promise<{ ws: WebSocket; messages: { type: string; t0?: number }[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/feed`);
    const messages: { type: string; t0?: number }[] = [];
    ws.on('message', (data: Buffer) =>
      messages.push(JSON.parse(data.toString('utf8')) as { type: string; t0?: number }),
    );
    ws.once('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

test('SECNET-01: malformed native frames cannot restart the phone worker or interrupt an already paired feed', async () => {
  const { app } = await launchApp(NETWORK_ENV);
  const opened: WebSocket[] = [];
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const { port, base } = await networkOn(win);
    const token = await pairToken(win, port, 'remote', 'Placeholder paired phone');
    const peer = await feed(port);
    opened.push(peer.ws);
    peer.ws.send(JSON.stringify({ type: 'hello', token }));
    await expect.poll(() => peer.messages.some((m) => m.type === 'welcome')).toBe(true);
    let clock = 0;
    for (const paired of [false, true]) {
      for (const frame of [
        'null',
        '[]',
        'true',
        '1',
        '"scalar"',
        '{"type":"unknown"}',
        Buffer.from('binary'),
        'x'.repeat(5000),
      ]) {
        const bad = await feed(port);
        opened.push(bad.ws);
        if (paired) {
          bad.ws.send(JSON.stringify({ type: 'hello', token }));
          await expect.poll(() => bad.messages.some((m) => m.type === 'welcome')).toBe(true);
        }
        bad.ws.send(frame);
        await expect.poll(() => bad.ws.readyState).toBe(WebSocket.CLOSED);
        expect(peer.ws.readyState).toBe(WebSocket.OPEN);
        peer.ws.send(JSON.stringify({ type: 'clock', t0: ++clock }));
        await expect.poll(() => peer.messages.some((m) => m.type === 'clock' && m.t0 === clock)).toBe(true);
      }
    }
    expect((await fetch(`${base}/remote`)).status).toBe(200);
    expect(
      await win.evaluate(async () => (await (globalThis as PageGlobals).drashti.network.status()).state),
    ).toBe('listening');
  } finally {
    for (const ws of opened) ws.terminate();
    await app.close();
  }
});

test('SECNET-03/U01: HLS and update redirects cannot reach a different local service', async () => {
  let prohibited = 0,
    streams = 0,
    manifests = 0;
  const sink = await server((_req, res) => {
    prohibited++;
    res.end('private placeholder');
  });
  const source = await server((req, res) => {
    if (req.url?.endsWith('drashti-update.json')) manifests++;
    else streams++;
    res.writeHead(302, { Location: `${sink.base}/private` });
    res.end();
  });
  const { app } = await launchApp({ DRASHTI_UPDATE_URL: source.base });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const link = await win.evaluate(
      async (url) => (globalThis as PageGlobals).drashti.liveLink.show(url),
      `${source.base}/live.m3u8`,
    );
    expect(link.ok).toBe(false);
    await win.evaluate(async () => (globalThis as PageGlobals).drashti.updates.check());
    expect(
      await win.evaluate(async () => (await (globalThis as PageGlobals).drashti.updates.view()).phase),
    ).toBe('error');
    expect(streams).toBe(1);
    expect(manifests).toBe(1);
    expect(prohibited).toBe(0);
  } finally {
    await app.close();
    await close(source.server);
    await close(sink.server);
  }
});

test('SECNET-01: malformed node frames leave Main’s worker and a second paired node online', async () => {
  const main = await launchMain();
  const opened: WebSocket[] = [];
  let peer: LinkClient | null = null;
  try {
    const version = (await nodesStatus(main.win)).main.version;
    const pair = async (name: string) => {
      const code = await nodeCode(main.win);
      const result = await pairWithMain({
        address: `127.0.0.1:${main.port}`,
        defaultPort: main.port,
        code,
        name,
        version,
      });
      if (!result.ok) throw new Error(result.message);
      return result;
    };
    const good = await pair('Placeholder stable node');
    const bad = await pair('Placeholder malformed node');
    const states: string[] = [];
    peer = new LinkClient(good.main, good.token, version, {
      state: (state) => states.push(state),
      welcome: () => undefined,
      message: () => undefined,
      clock: () => undefined,
      removed: () => undefined,
    });
    peer.start();
    await expect.poll(() => states.at(-1)).toBe('online');
    const stable = [...states];
    for (const paired of [false, true]) {
      for (const frame of ['null', '[]', '1', '{"type":"unknown"}', '{"type":"health","health":null}']) {
        // Dummy loopback server only. Pairing above and the independent peer exercise the real saved certificate pin.
        const ws = new WebSocket(`wss://127.0.0.1:${main.port}/node/v1/feed`, { rejectUnauthorized: false });
        opened.push(ws);
        await new Promise<void>((resolve, reject) => {
          ws.once('open', resolve);
          ws.once('error', reject);
        });
        if (paired) {
          const welcome = new Promise<void>((resolve) => ws.once('message', () => resolve()));
          ws.send(
            JSON.stringify({
              type: 'hello',
              token: bad.token,
              version,
              protocol: NODE_PROTOCOL,
              engine: ENGINE_STATE_VERSION,
            }),
          );
          await welcome;
        }
        ws.send(frame);
        await expect.poll(() => ws.readyState).toBe(WebSocket.CLOSED);
        expect(states).toEqual(stable);
        expect((await nodesStatus(main.win)).nodes.find((n) => n.id === good.node.id)?.online).toBe(true);
      }
    }
  } finally {
    peer?.stop();
    for (const ws of opened) ws.terminate();
    await main.app.close();
  }
});

test('U01 review: Electron follows approved release redirects for both the manifest and checked download', async () => {
  const bytes = Buffer.from('placeholder installer bytes');
  const paths: string[] = [];
  const source = await server((req, res) => {
    paths.push(req.url ?? '');
    const redirects: Record<string, string> = {
      '/latest/download/drashti-update.json': '/download/v9.9.9/drashti-update.json',
      '/download/v9.9.9/drashti-update.json': '/assets/manifest.json',
      '/download/v9.9.9/placeholder.bin': '/assets/placeholder.bin',
    };
    const location = redirects[req.url ?? ''];
    if (location) {
      res.writeHead(302, { Location: location });
      res.end();
    } else if (req.url === '/assets/manifest.json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          app: 'drashti',
          version: '9.9.9',
          releasedAt: '2026-11-28T00:00:00Z',
          notes: 'Placeholder update notes.',
          source: `${source.base}/tag/v9.9.9`,
          files: [
            {
              platform: process.platform,
              arch: process.arch,
              kind: process.platform === 'win32' ? 'nsis' : 'zip',
              name: process.platform === 'win32' ? 'Placeholder.exe' : 'Placeholder.zip',
              url: `${source.base}/download/v9.9.9/placeholder.bin`,
              size: bytes.length,
              sha512: createHash('sha512').update(bytes).digest('base64'),
            },
          ],
        }),
      );
    } else if (req.url === '/assets/placeholder.bin') res.end(bytes);
    else {
      res.writeHead(404);
      res.end();
    }
  });
  const { app } = await launchApp({ DRASHTI_UPDATE_URL: source.base });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await win.evaluate(async () => (globalThis as PageGlobals).drashti.updates.check());
    expect(
      await win.evaluate(async () => (await (globalThis as PageGlobals).drashti.updates.view()).phase),
    ).toBe('available');
    await win.evaluate(async () => (globalThis as PageGlobals).drashti.updates.download());
    await expect
      .poll(async () =>
        win.evaluate(async () => (await (globalThis as PageGlobals).drashti.updates.view()).phase),
      )
      .toBe('ready');
    expect(paths).toEqual([
      '/latest/download/drashti-update.json',
      '/download/v9.9.9/drashti-update.json',
      '/assets/manifest.json',
      '/download/v9.9.9/placeholder.bin',
      '/assets/placeholder.bin',
    ]);
  } finally {
    await app.close();
    await close(source.server);
  }
});
