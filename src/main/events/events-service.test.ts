import { describe, expect, it } from 'vitest';
import type { TryResult } from './delivery';
import { EventsOut, OLD_SECRET_MS } from './events-service';
import type { Resolve } from './policy';
import type { PostRequest } from './post';
import type { FromEventsWorker, ToEventsWorker } from './protocol';
import { eventsSender } from './sender';
import { githubStyleSignature, verifyStandard } from './signing';
import type { EventsWorker } from './spawn-worker';

/*
 * Events out in the main process (Session 28): nothing on and no process until an address ticks a kind;
 * each event signed both ways, with ids and kinds only unless the words are ticked; the local network
 * unless allowed (one https address on the internet at most); a 410 turns the address off for good, with a
 * notice; a window never sees an address's path or secret. The worker runs here in-process, its requests
 * answered by a stand-in: nothing here goes on the network. The secrets are made up as each test runs.
 */

const MARKER = 'Zqxmarkerword';
const names: Record<string, string> = { 'n8n.local': '192.168.1.20', 'hook.example': '203.0.113.10' };
const resolve: Resolve = (host) =>
  names[host]
    ? Promise.resolve([{ address: names[host], family: 4 }])
    : Promise.reject(new Error('ENOTFOUND'));

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

function harness(
  answer: (r: PostRequest) => TryResult = () => ({ status: 200 }),
  options: { available?: boolean; onlyThisComputer?: boolean; kept?: Map<string, string> } = {},
) {
  const kept = options.kept ?? new Map<string, string>();
  const store = {
    status: () =>
      options.available === false
        ? { available: false, message: 'No secure storage here.' }
        : { available: true, message: null },
    ids: () => [...kept.keys()],
    get: (id: string) => kept.get(id) ?? null,
    set: (id: string, value: string) => {
      if (options.available === false) return { ok: false as const, message: 'No secure storage here.' };
      kept.set(id, value);
      return { ok: true as const };
    },
    remove: (id: string) => {
      kept.delete(id);
    },
  };
  const posts: PostRequest[] = [];
  let now = 1_800_000_000_000;
  const timers = new Set<{ at: number; run: () => void }>();
  const later = (ms: number, run: () => void) => {
    const t = { at: now + ms, run };
    timers.add(t);
    return () => {
      timers.delete(t);
    };
  };
  const workers: { crash: () => void; killed: boolean }[] = [];
  const spawn = (): EventsWorker => {
    let listener: ((m: FromEventsWorker) => void) | null = null;
    let exit: (() => void) | null = null;
    const w = { crash: () => exit?.(), killed: false };
    workers.push(w);
    const handle = eventsSender((m) => listener?.(m), {
      post: (r) => {
        posts.push(r);
        return Promise.resolve(answer(r));
      },
      resolve,
      now: () => now,
      later,
      random: () => 0.5,
    });
    return {
      post: (m: ToEventsWorker) => {
        if (!w.killed) handle(structuredClone(m));
      },
      onMessage: (l) => {
        listener = l;
      },
      onExit: (l) => {
        exit = l;
      },
      kill: () => {
        w.killed = true;
      },
    };
  };
  const notices: string[] = [];
  const logs: string[] = [];
  const views: unknown[] = [];
  const service = new EventsOut({
    store,
    spawn,
    onlyThisComputer: options.onlyThisComputer ?? false,
    resolve,
    now: () => now,
    changed: (v) => views.push(v),
    notice: (t) => notices.push(t),
    log: (_l, m) => logs.push(m),
    later,
  });
  const advance = async (ms: number) => {
    now += ms;
    for (const t of [...timers].sort((a, b) => a.at - b.at))
      if (t.at <= now) {
        timers.delete(t);
        t.run();
      }
    await settle();
  };
  return { service, posts, workers, notices, logs, views, kept, advance, now: () => now };
}

const slideEvent = {
  kind: 'slide.changed' as const,
  data: { presentationId: 'p1', slideIndex: 0 },
  words: { text: MARKER },
};

describe('events out', () => {
  it('nothing goes and no process starts until an address ticks a kind', async () => {
    const h = harness();
    h.service.emit([slideEvent]);
    const added = await h.service.add('http://n8n.local:5678/webhook/drashti', false);
    expect(added.ok).toBe(true);
    h.service.emit([slideEvent]);
    await settle();
    expect(h.workers).toHaveLength(0);
    expect(h.posts).toHaveLength(0);
  });

  it('each event signed both ways, ids and kinds only unless the words are ticked', async () => {
    const h = harness();
    const added = await h.service.add('http://n8n.local:5678/webhook/drashti', false);
    if (!added.ok || !added.secret) throw new Error('not added');
    const secret = added.secret;
    const id = added.view.addresses[0]?.id ?? '';
    await h.service.update(id, { kinds: ['slide.changed'] });
    h.service.emit([slideEvent, { kind: 'blackout.changed', data: { on: true } }]);
    await settle();
    expect(h.posts).toHaveLength(1);
    const [first] = h.posts;
    if (!first) throw new Error('nothing sent');
    // To the address checked, with the name kept for the Host header.
    expect(first.ip).toBe('192.168.1.20');
    expect(first.url.host).toBe('n8n.local:5678');
    const sent = JSON.parse(first.body) as { type: string; data: Record<string, unknown> };
    expect(sent).toMatchObject({ type: 'slide.changed', data: { presentationId: 'p1', slideIndex: 0 } });
    expect(first.body).not.toContain(MARKER);
    const h1 = first.headers;
    expect(
      verifyStandard(
        secret,
        h1['webhook-id'] ?? '',
        Number(h1['webhook-timestamp']),
        first.body,
        h1['webhook-signature'] ?? '',
      ),
    ).toBe(true);
    expect(h1['x-drashti-signature-256']).toBe(githubStyleSignature(secret, first.body));
    // Words ticked: they come too.
    await h.service.update(id, { words: ['slide.changed'] });
    h.service.emit([slideEvent]);
    await settle();
    expect(h.posts[1]?.body).toContain(MARKER);
  });

  it('a window sees the host only, never the path or the secret; nothing but the address is kept', async () => {
    const h = harness();
    const added = await h.service.add('http://n8n.local:5678/webhook/pathtoken123', false);
    if (!added.ok) throw new Error('not added');
    const seen = JSON.stringify(h.service.view());
    expect(seen).toContain('n8n.local:5678');
    expect(seen).not.toContain('pathtoken123');
    expect(seen).not.toContain(added.secret ?? 'none');
    expect(JSON.stringify(h.views)).not.toContain('pathtoken123');
    expect(h.logs.join('\n')).not.toContain('pathtoken123');
  });

  it('local addresses unless allowed; then https only; one internet address at most', async () => {
    const h = harness();
    expect(await h.service.add('https://hook.example/x', false)).toMatchObject({ ok: false });
    expect(await h.service.add('http://hook.example/x', true)).toMatchObject({
      ok: false,
      message: 'An address on the internet must start https://.',
    });
    expect(await h.service.add('https://hook.example/x', true)).toMatchObject({ ok: true });
    expect(await h.service.add('https://hook.example/y', true)).toMatchObject({
      ok: false,
      message: 'Only one address may be on the internet, and hook.example is. Turn that off first.',
    });
  });

  it('a 410 turns the address off, kept off after a restart, with a notice; on again starts afresh', async () => {
    let answer: TryResult = { status: 410 };
    const h = harness(() => answer);
    const added = await h.service.add('http://n8n.local:5678/webhook/drashti', false);
    const id = added.ok ? (added.view.addresses[0]?.id ?? '') : '';
    await h.service.update(id, { kinds: ['blackout.changed'] });
    h.service.emit([{ kind: 'blackout.changed', data: { on: true } }]);
    await settle();
    expect(h.service.view().addresses[0]?.off).toBe(true);
    expect(h.notices.join('\n')).toContain('said it is gone');
    h.service.emit([{ kind: 'blackout.changed', data: { on: false } }]);
    await settle();
    expect(h.posts).toHaveLength(1);
    // A restart reads it as off.
    const again = harness(() => answer, { kept: h.kept });
    again.service.load();
    expect(again.service.view().addresses[0]?.off).toBe(true);
    // Turned on again: sent to.
    answer = { status: 204 };
    await h.service.update(id, { on: true });
    h.service.emit([{ kind: 'blackout.changed', data: { on: true } }]);
    await settle();
    expect(h.posts).toHaveLength(2);
    expect(h.service.view().addresses[0]?.status.lastSuccess?.status).toBe(204);
  });

  it('a 404 is a setup problem; a failing receiver is retried, then the event dropped and counted', async () => {
    const h = harness(() => ({ status: 404 }));
    const added = await h.service.add('http://n8n.local:5678/webhook/drashti', false);
    const id = added.ok ? (added.view.addresses[0]?.id ?? '') : '';
    await h.service.update(id, { kinds: ['blackout.changed'] });
    h.service.emit([{ kind: 'blackout.changed', data: { on: true } }]);
    await settle();
    await h.advance(10_000);
    await h.advance(60_000);
    // Tried three times in all, then dropped.
    expect(h.posts).toHaveLength(3);
    const status = h.service.view().addresses[0]?.status;
    expect(status).toMatchObject({ setupProblem: true, dropped: 1 });
    // The same id on each try.
    expect(new Set(h.posts.map((p) => p.headers['webhook-id'])).size).toBe(1);
  });

  it('Rotate: a new secret, shown once; the old one signs too for a day', async () => {
    const h = harness();
    const added = await h.service.add('http://n8n.local:5678/webhook/drashti', false);
    if (!added.ok || !added.secret) throw new Error('not added');
    const id = added.view.addresses[0]?.id ?? '';
    await h.service.update(id, { kinds: ['blackout.changed'] });
    const rotated = h.service.rotate(id);
    if (!rotated.ok || !rotated.secret) throw new Error('not rotated');
    expect(rotated.secret).not.toBe(added.secret);
    h.service.emit([{ kind: 'blackout.changed', data: { on: true } }]);
    await settle();
    const p = h.posts[0];
    if (!p) throw new Error('nothing sent');
    const check = (secret: string) =>
      verifyStandard(
        secret,
        p.headers['webhook-id'] ?? '',
        Number(p.headers['webhook-timestamp']),
        p.body,
        p.headers['webhook-signature'] ?? '',
      );
    expect(check(rotated.secret)).toBe(true);
    expect(check(added.secret)).toBe(true);
    // A day later, the old one no longer.
    await h.advance(OLD_SECRET_MS + 1000);
    h.service.rotate(id);
    h.service.emit([{ kind: 'blackout.changed', data: { on: false } }]);
    await settle();
    const q = h.posts[1];
    if (!q) throw new Error('nothing sent');
    expect(
      verifyStandard(
        added.secret,
        q.headers['webhook-id'] ?? '',
        Number(q.headers['webhook-timestamp']),
        q.body,
        q.headers['webhook-signature'] ?? '',
      ),
    ).toBe(false);
  });

  it('Send a test: once, at once, said in words', async () => {
    const h = harness(() => ({ status: 200 }));
    const added = await h.service.add('http://n8n.local:5678/webhook/drashti', false);
    const id = added.ok ? (added.view.addresses[0]?.id ?? '') : '';
    expect(await h.service.test(id)).toEqual({
      ok: true,
      message: 'The receiver answered 200: events reach it.',
    });
    expect(JSON.parse(h.posts[0]?.body ?? '{}')).toMatchObject({ type: 'drashti.test' });
  });

  it('the process stopping: started again a second later, its queue gone', async () => {
    const h = harness();
    const added = await h.service.add('http://n8n.local:5678/webhook/drashti', false);
    const id = added.ok ? (added.view.addresses[0]?.id ?? '') : '';
    await h.service.update(id, { kinds: ['blackout.changed'] });
    h.service.emit([{ kind: 'blackout.changed', data: { on: true } }]);
    await settle();
    h.workers[0]?.crash();
    expect(h.workers).toHaveLength(1);
    await h.advance(1000);
    expect(h.workers).toHaveLength(2);
    h.service.close();
    expect(h.workers[1]?.killed).toBe(true);
  });

  it('at the start, the keychain is asked only when addresses are kept (an Intel build on a Mac blocked there)', () => {
    let asked = 0;
    const store = {
      status: () => {
        asked += 1;
        return { available: true, message: null };
      },
      ids: () => [] as string[],
      get: () => null,
      set: () => ({ ok: true as const }),
      remove: () => undefined,
    };
    const service = new EventsOut({
      store,
      spawn: () => {
        throw new Error('no worker');
      },
      onlyThisComputer: false,
      resolve: () => Promise.resolve([]),
      now: () => 0,
      changed: () => undefined,
      notice: () => undefined,
      log: () => undefined,
    });
    service.load();
    expect(asked).toBe(0);
  });

  it('without secure storage nothing is kept', async () => {
    const h = harness(undefined, { available: false });
    expect(await h.service.add('http://n8n.local:5678/webhook/drashti', false)).toMatchObject({ ok: false });
    expect(h.service.view()).toMatchObject({ available: false, addresses: [] });
  });

  it('a test of Drashti adds only 127.0.0.1, refused loudly otherwise', async () => {
    const h = harness(undefined, { onlyThisComputer: true });
    expect(await h.service.add('http://127.0.0.1:9/hook', false)).toMatchObject({ ok: true });
    expect(await h.service.add('http://n8n.local:5678/webhook/drashti', false)).toMatchObject({ ok: false });
    expect(h.logs.join('\n')).toContain('TEST GUARD');
  });
});
