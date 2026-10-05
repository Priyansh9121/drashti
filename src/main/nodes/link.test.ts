import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import type { NodeHealth, ToNode } from '../../shared/nodes';
import { versionMismatch } from '../../shared/nodes';
import { LinkClient, openMediaFromMain, pairWithMain, type PinnedMain } from '../node-mode/link-client';
import { makeIdentity } from './certificate';
import { hashToken } from '../network/tokens';
import { byteRange, type LinkHost, LinkServer } from './link-server';

/*
 * The node link end to end on this computer: Main's server and a node's
 * client, with made-up codes, names and files. Pairing proves the code over
 * the certificate; a wrong code, another version and a fake Main are
 * refused; the feed brings the show; removing a node cuts it off; media come
 * by range and are checked by hash.
 */

const VERSION = '1.0.0-test';
const main = makeIdentity('Placeholder Main');
let server: LinkServer | null = null;
let dir = '';

afterEach(async () => {
  await server?.stop();
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

interface Fake extends LinkHost {
  kept: { name: string; tokenHash: string }[];
  events: string[];
  healths: NodeHealth[];
}

async function start(identity = main, port = 0) {
  dir = mkdtempSync(join(tmpdir(), 'drashti-link-'));
  const file = join(dir, 'placeholder.bin');
  const bytes = Buffer.alloc(300_000, 7);
  writeFileSync(file, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const host: Fake = {
    kept: [],
    events: [],
    healths: [],
    paired: (node) => {
      host.kept.push(node);
      return Promise.resolve({ id: `node-${host.kept.length}`, name: node.name });
    },
    offerDropped: () => {
      host.events.push('dropped');
    },
    mediaFile: (id) =>
      Promise.resolve(
        id === 'placeholder-media' ? { path: file, sha256, bytes: bytes.length, ext: 'bin' } : null,
      ),
    online: (id) => {
      host.events.push(`online ${id}`);
    },
    offline: (id) => {
      host.events.push(`offline ${id}`);
    },
    health: (_id, h) => {
      host.healths.push(h);
    },
    thumb: () => undefined,
    refused: (id, version) => {
      host.events.push(`refused ${id} ${version}`);
    },
    resync: () => undefined,
    log: () => undefined,
  };
  server = new LinkServer(host);
  const started = await server.start({
    port,
    bind: '127.0.0.1',
    cert: identity.certPem,
    key: identity.keyPem,
    fingerprint: identity.fingerprint,
    main: { id: 'main-1', name: 'Placeholder Main', version: VERSION },
    addresses: ['127.0.0.1'],
    session: 'run-1',
    bytesPerSecond: 50 * 1024 * 1024,
  });
  if (!started.ok) throw new Error(started.message);
  server.engine({
    kind: 'snapshot',
    version: ENGINE_STATE_VERSION,
    rev: 5,
    state: initialEngineState(),
    sentAt: Date.now(),
    session: 'run-1',
  });
  return { host, port: started.port, server, sha256, size: bytes.length };
}

const pair = (port: number, code: string, version = VERSION) =>
  pairWithMain({ address: `127.0.0.1:${port}`, defaultPort: 8741, code, name: 'Placeholder Node', version });

describe('the node link', () => {
  it('pairs with the right code, and refuses a wrong one, an expired one and another version', async () => {
    const { port, host, server: s } = await start();
    // No code offered.
    const none = await pair(port, '123456');
    expect(none.ok ? '' : none.message).toContain('not offering');
    s.setOffer({ code: '482913', expiresAt: Date.now() + 60_000 });
    expect(await pair(port, '000000')).toEqual({
      ok: false,
      message: 'That code is wrong or has expired. Ask for a new code on Main.',
    });
    expect(await pair(port, '482913', '0.9.0')).toEqual({
      ok: false,
      message: versionMismatch(VERSION, '0.9.0'),
      mainVersion: VERSION,
    });
    const ok = await pair(port, '482 913');
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.main.fingerprint).toBe(main.fingerprint);
    expect(ok.node).toEqual({ id: 'node-1', name: 'Placeholder Node' });
    expect(host.kept[0]?.tokenHash).toBe(createHash('sha256').update(ok.token).digest('hex'));
    // The code works once.
    expect((await pair(port, '482913')).ok).toBe(false);
  });

  it('refuses an address after five wrong codes in a minute, the right code too', async () => {
    const { port, host, server: s } = await start();
    s.setOffer({ code: '482913', expiresAt: Date.now() + 60_000 });
    // Five wrong a minute from one address are allowed; the limiter then refuses before the code is read.
    for (let i = 0; i < 5; i++) expect((await pair(port, `00000${i}`)).ok).toBe(false);
    const limited = await pair(port, '482913');
    expect(limited.ok ? '' : limited.message).toContain('Too many');
    expect(host.kept).toHaveLength(0);
  });

  it('follows the feed with the pinned certificate; a fake Main is refused; a removed node is cut off', async () => {
    const { port, host, server: s } = await start();
    s.setOffer({ code: '482913', expiresAt: Date.now() + 60_000 });
    const paired = await pair(port, '482913');
    if (!paired.ok) throw new Error(paired.message);
    s.setNodes([{ id: paired.node.id, name: paired.node.name, tokenHash: host.kept[0]?.tokenHash ?? '' }]);
    s.setScreens(paired.node.id, []);
    const got: ToNode[] = [];
    const states: string[] = [];
    let removed = false;
    const client = new LinkClient(paired.main, paired.token, VERSION, {
      state: (state, why) => {
        states.push(`${state}${why ? `: ${why}` : ''}`);
      },
      welcome: () => undefined,
      message: (m) => got.push(m),
      clock: () => undefined,
      removed: () => {
        removed = true;
      },
    });
    client.start();
    await expect.poll(() => got.some((m) => m.type === 'engine')).toBe(true);
    expect(got.find((m) => m.type === 'engine')).toMatchObject({
      message: { kind: 'snapshot', rev: 5, session: 'run-1' },
    });
    expect(got.some((m) => m.type === 'screens')).toBe(true);
    expect(host.events).toContain(`online ${paired.node.id}`);
    // Health reaches Main, checked.
    client.sendHealth({
      version: VERSION,
      host: 'Placeholder Node',
      displays: [],
      outputs: [],
      media: {
        wanted: 0,
        ready: 0,
        bytesWanted: 0,
        bytesReady: 0,
        copying: null,
        missingNow: 0,
        problem: null,
      },
      clock: null,
      rev: 5,
    });
    await expect.poll(() => host.healths.length).toBe(1);
    // Removed on Main: cut off at once, and told so.
    s.setNodes([]);
    await expect.poll(() => removed).toBe(true);
    expect(states.at(-1)).toMatch(/^unpaired/u);
    client.stop();

    // Another computer at Main's address with another certificate (same name): refused before a word.
    await s.stop();
    const fake = makeIdentity('Placeholder Main');
    const { server: impostor, host: fakeHost } = await start(fake, port);
    impostor.setNodes([{ id: paired.node.id, name: 'x', tokenHash: host.kept[0]?.tokenHash ?? '' }]);
    const refused: string[] = [];
    const again = new LinkClient(paired.main, paired.token, VERSION, {
      state: (state, why) => {
        refused.push(`${state}: ${why ?? ''}`);
      },
      welcome: () => undefined,
      message: () => undefined,
      clock: () => undefined,
      removed: () => undefined,
    });
    again.start();
    await expect.poll(() => refused.some((r) => r.startsWith('refused'))).toBe(true);
    expect(refused.find((r) => r.startsWith('refused'))).toContain('is not the Main this node paired with');
    expect(fakeHost.events.filter((e) => e.startsWith('online'))).toEqual([]);
    again.stop();
  });

  it('says plainly when the two computers disagree about the date, and keeps trying', async () => {
    // Main made its certificate on a day still to come by this computer's clock (its clock was
    // wrong, or this one is): not valid yet here. And one made so long ago that it has run out.
    const future = makeIdentity('Placeholder Main', new Date(Date.now() + 10 * 24 * 3600 * 1000));
    const past = makeIdentity('Placeholder Main', new Date(Date.now() - 31 * 365 * 24 * 3600 * 1000));
    for (const [identity, words] of [
      [future, 'Main’s certificate is not valid yet'],
      [past, 'Main’s certificate has run out'],
    ] as const) {
      const { port, server: s } = await start(identity);
      s.setOffer({ code: '482913', expiresAt: Date.now() + 60_000 });
      const paired = await pair(port, '482913');
      expect(paired.ok).toBe(false);
      expect(paired.ok ? '' : paired.message).toContain(words);
      expect(paired.ok ? '' : paired.message).toContain('Check the date and time on both computers.');
      // A node paired before the clock went wrong: refused on the feed, saying why, and trying again by itself.
      s.setNodes([
        { id: 'n1', name: 'Placeholder Node', tokenHash: hashToken('test-made-up-node-token-000000000000') },
      ]);
      const states: string[] = [];
      const client = new LinkClient(
        {
          id: 'main-1',
          name: 'Placeholder Main',
          certPem: identity.certPem,
          fingerprint: identity.fingerprint,
          addresses: ['127.0.0.1'],
          port,
        },
        'test-made-up-node-token-000000000000',
        VERSION,
        {
          state: (state, why) => {
            states.push(`${state}: ${why ?? ''}`);
          },
          welcome: () => undefined,
          message: () => undefined,
          clock: () => undefined,
          removed: () => undefined,
        },
      );
      client.start();
      await expect
        .poll(() => states.filter((x) => x.startsWith('refused')).length, { timeout: 10_000 })
        .toBeGreaterThanOrEqual(2);
      const refusal = states.find((x) => x.startsWith('refused')) ?? '';
      expect(refusal).toContain(words);
      expect(refusal).toContain('Check the date and time on both computers. Trying again…');
      client.stop();
      await s.stop();
      server = null;
      rmSync(dir, { recursive: true, force: true });
      dir = '';
    }
  });

  it('refuses a node on another version, on the feed too, and says so on both sides', async () => {
    const { port, host, server: s } = await start();
    s.setOffer({ code: '482913', expiresAt: Date.now() + 60_000 });
    const paired = await pair(port, '482913');
    if (!paired.ok) throw new Error(paired.message);
    s.setNodes([{ id: paired.node.id, name: paired.node.name, tokenHash: host.kept[0]?.tokenHash ?? '' }]);
    const states: string[] = [];
    const client = new LinkClient(paired.main, paired.token, '9.9.9', {
      state: (state, why) => {
        states.push(`${state}: ${why ?? ''}`);
      },
      welcome: () => undefined,
      message: () => undefined,
      clock: () => undefined,
      removed: () => undefined,
    });
    client.start();
    await expect.poll(() => states.some((x) => x.startsWith('refused'))).toBe(true);
    expect(states.find((x) => x.startsWith('refused'))).toContain(versionMismatch(VERSION, '9.9.9'));
    expect(host.events).toContain(`refused ${paired.node.id} 9.9.9`);
    client.stop();
  });

  it('serves media to a paired node only, by range, with its hash', async () => {
    const { port, host, server: s, sha256, size } = await start();
    s.setOffer({ code: '482913', expiresAt: Date.now() + 60_000 });
    const paired = await pair(port, '482913');
    if (!paired.ok) throw new Error(paired.message);
    s.setNodes([{ id: paired.node.id, name: paired.node.name, tokenHash: host.kept[0]?.tokenHash ?? '' }]);
    const pinned: PinnedMain = paired.main;
    const read = async (from: number, token = paired.token, id = 'placeholder-media') => {
      const res = await openMediaFromMain(pinned, '127.0.0.1', token, id, from);
      const chunks: Buffer[] = [];
      for await (const c of res) chunks.push(c as Buffer);
      return { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) };
    };
    const whole = await read(0);
    expect(whole.status).toBe(200);
    expect(whole.headers['x-drashti-sha256']).toBe(sha256);
    expect(whole.headers['x-drashti-ext']).toBe('bin');
    expect(whole.body.length).toBe(size);
    const rest = await read(100_000);
    expect(rest.status).toBe(206);
    expect(rest.body.length).toBe(size - 100_000);
    expect((await read(0, 'test-made-up-wrong-token-000000000000')).status).toBe(401);
    expect((await read(0, paired.token, 'no-such-media')).status).toBe(404);
    expect(byteRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(byteRange('bytes=100-', 100)).toBe('bad');
    expect(byteRange(undefined, 100)).toBeNull();
  });
});
