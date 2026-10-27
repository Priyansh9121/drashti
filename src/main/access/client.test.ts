import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { PLACEHOLDER_APPROVER, placeholderComputer, TestList } from '../../../tests/access-core';
import { accessStandIn, type AccessStandIn } from '../../../tests/access-standin';
import { ACCESS_LIST_PUBLIC_KEY, ACCESS_LIST_URL, accessConfigReal } from '../../shared/access-config';
import { NO_ACTIVITY } from '../../shared/access-protocol';
import { switchesFor } from '../switches';
import {
  AccessClient,
  accessTarget,
  nodeTransport,
  type AccessReply,
  type AccessResult,
  type AccessTransport,
} from './client';

/*
 * Drashti's side of the access list (Session 54, E1, client.ts), against the stand-in list on 127.0.0.1
 * (the list's own rules), and against "Google" made in this process for what only HTTPS addresses can show.
 * No test reaches the internet. Placeholder addresses only.
 */

const PERSON = 'placeholder.user@example.com';
const GOOGLE = 'https://script.google.com/macros/s/AKfycbMadeUpDeploymentId0123456789/exec';
let standIn: AccessStandIn | null = null;

afterEach(async () => {
  await standIn?.close();
  standIn = null;
});

async function stand(): Promise<AccessStandIn> {
  standIn = await accessStandIn();
  return standIn;
}

const clientOf = (
  s: AccessStandIn,
  hardware: string,
  more: Partial<ConstructorParameters<typeof AccessClient>[0]> = {},
) =>
  new AccessClient({
    url: s.url,
    publicKey: s.publicKey,
    computer: placeholderComputer(hardware),
    transport: nodeTransport,
    local: true,
    ...more,
  });

function value<T>(r: AccessResult<T>): T {
  if (!r.ok) throw new Error(`Expected an answer, got ${JSON.stringify(r)}`);
  return r.value;
}

/** A transport that keeps every request's body, then sends it on. */
function watched(): { transport: AccessTransport; bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  return {
    bodies,
    transport: (request) => {
      if (request.body !== null) bodies.push(JSON.parse(request.body) as Record<string, unknown>);
      return nodeTransport(request);
    },
  };
}

describe('asking for access', () => {
  it('asks, hears what became of the request, and comes in once with the token', async () => {
    const s = await stand();
    const c = clientOf(s, 'client-ask');
    expect(value(await c.request(PERSON, 'Placeholder Person'))).toEqual({
      status: 'requested',
      mailed: true,
    });
    expect(value(await c.status(PERSON))).toEqual({ status: 'requested', tokenWaiting: false });
    s.press(s.list.linksFor(PERSON)?.approve ?? '');
    expect(value(await c.status(PERSON))).toEqual({ status: 'approved', tokenWaiting: true });
    const token = s.list.tokenFor(PERSON) ?? '';
    const r = value(await c.redeem(PERSON, token));
    expect(r.owner).toBe(false);
    expect(r.grant).toMatchObject({
      gmail: PERSON,
      grantId: expect.stringMatching(/^[0-9a-f]{32}$/u) as unknown,
    });
    expect(await c.redeem(PERSON, token)).toMatchObject({ ok: false, kind: 'refused', error: 'bad-token' });
    expect(await c.request(PERSON)).toMatchObject({ ok: false, kind: 'refused', error: 'already-approved' });
    expect(s.calls).toEqual(['request', 'status', 'status', 'redeem', 'redeem', 'request']);
  });
});

describe('the checks', () => {
  it('are in while let in, and revoked at the next check after the owner revokes', async () => {
    const s = await stand();
    const person = clientOf(s, 'client-person');
    await person.request(PERSON);
    s.press(s.list.linksFor(PERSON)?.approve ?? '');
    const { grant } = value(await person.redeem(PERSON, s.list.tokenFor(PERSON) ?? ''));
    expect(value(await person.check(grant, { ...NO_ACTIVITY, shows: 2 }))).toEqual({
      status: 'in',
      owner: false,
      recorded: false,
    });
    const owner = clientOf(s, 'client-owner');
    const me = s.grant(PLACEHOLDER_APPROVER, placeholderComputer('client-owner'));
    expect(value(await owner.check(me, NO_ACTIVITY))).toMatchObject({ status: 'in', owner: true });
    expect(value(await owner.revoke(me, PERSON))).toEqual({ status: 'revoked' });
    s.list.move(6000);
    expect(value(await person.check(grant, NO_ACTIVITY))).toMatchObject({ status: 'revoked', owner: false });
  });

  it('sign each call with a new nonce and a rising `at`, and only the signed calls carry a mac', async () => {
    const s = await stand();
    let clock = 5_000_000;
    const w = watched();
    const c = clientOf(s, 'client-watched', { transport: w.transport, at: () => (clock -= 1000) });
    const grant = s.grant(PERSON, placeholderComputer('client-watched'));
    await c.status(PERSON);
    await c.check(grant, NO_ACTIVITY);
    s.list.move(6000);
    await c.check(grant, NO_ACTIVITY);
    const [status, first, second] = w.bodies;
    const nonces = w.bodies.map((b) => b['nonce']);
    expect(new Set(nonces).size).toBe(3);
    for (const n of nonces) expect(n).toMatch(/^[0-9a-f]{32}$/u);
    expect(status).not.toHaveProperty('mac');
    expect(first).toMatchObject({
      grantId: grant.grantId,
      mac: expect.stringMatching(/^[0-9a-f]{64}$/u) as unknown,
    });
    // This computer's clock went back a second: `at` still rises.
    expect(Number(second?.['at'])).toBe(Number(first?.['at']) + 1);
  });
});

describe('the owner’s calls', () => {
  it('are each typed, and refused not-owner from anyone else', async () => {
    const s = await stand();
    const owner = clientOf(s, 'client-owner-ops');
    const me = s.grant(PLACEHOLDER_APPROVER, placeholderComputer('client-owner-ops'));
    expect(value(await owner.add(me, PERSON, { name: 'Placeholder Added', note: 'Hall team' }))).toEqual({
      status: 'requested',
      mailed: true,
    });
    expect(value(await owner.approve(me, PERSON))).toMatchObject({
      status: 'approved',
      runsOut: expect.any(Number) as unknown,
    });
    expect(value(await owner.regrant(me, PERSON))).toMatchObject({ status: 'approved' });
    expect(value(await owner.note(me, PERSON, 'Placeholder note'))).toEqual({});
    expect(value(await owner.add(me, 'placeholder.other@example.com'))).toMatchObject({
      status: 'requested',
    });
    expect(value(await owner.reject(me, 'placeholder.other@example.com'))).toEqual({
      status: 'rejected',
      mailed: true,
    });
    const people = value(await owner.list(me)).people;
    expect(people.map((p) => [p.gmail, p.status, p.owner])).toEqual([
      [PLACEHOLDER_APPROVER, 'approved', true],
      [PERSON, 'approved', false],
      ['placeholder.other@example.com', 'rejected', false],
    ]);
    expect(people[1]).toMatchObject({
      name: 'Placeholder Added',
      note: 'Placeholder note',
      token: { runsOut: expect.any(Number) as unknown },
    });
    expect(await owner.revoke(me, PLACEHOLDER_APPROVER)).toMatchObject({ ok: false, error: 'owner-row' });

    const someone = clientOf(s, 'client-someone');
    const theirs = s.grant('placeholder.someone@example.com', placeholderComputer('client-someone'));
    expect(await someone.list(theirs)).toMatchObject({ ok: false, kind: 'refused', error: 'not-owner' });
    expect(await someone.revoke(theirs, PERSON)).toMatchObject({
      ok: false,
      kind: 'refused',
      error: 'not-owner',
    });
  });
});

describe('what is never believed', () => {
  it('an answer not signed with the list’s key, unsigned, or changed on the way', async () => {
    const s = await stand();
    const c = clientOf(s, 'client-forged');
    const { privateKey: other } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    s.tamper = (a) => ({
      payload: a.payload,
      sig: sign('sha256', Buffer.from(a.payload), other).toString('base64'),
    });
    expect(await c.status(PERSON)).toMatchObject({ ok: false, kind: 'no-answer', reason: 'signature' });
    s.tamper = (a) => ({
      payload: a.payload.replace('"status":"unknown"', '"status":"approved"'),
      sig: a.sig,
    });
    expect(await c.status(PERSON)).toMatchObject({ reason: 'signature' });
    s.tamper = (a) => ({
      payload: a.payload,
      sig: `${a.sig.startsWith('A') ? 'B' : 'A'}${a.sig.substring(1)}`,
    });
    expect(await c.status(PERSON)).toMatchObject({ reason: 'signature' });
    s.tamper = () => ({ payload: 'not json', sig: '' });
    expect(await c.status(PERSON)).toMatchObject({ reason: 'unsigned' });
    s.tamper = null;
    s.mode = 'unsigned';
    expect(await c.status(PERSON)).toMatchObject({ reason: 'unsigned' });
    s.mode = 'answer';
    expect(await c.status(PERSON)).toMatchObject({ ok: true });
  });

  it('an old answer, or another computer’s, though signed by the list', async () => {
    const s = await stand();
    const a = clientOf(s, 'client-a');
    const b = clientOf(s, 'client-b');
    let kept: { payload: string; sig: string } | null = null;
    s.tamper = (answer) => {
      kept ??= answer;
      return kept;
    };
    expect(await a.status(PERSON)).toMatchObject({ ok: true });
    // The same answer again: another nonce was asked for.
    expect(await a.status(PERSON)).toMatchObject({ ok: false, kind: 'no-answer', reason: 'not-ours' });
    // Another computer's answer.
    expect(await b.status(PERSON)).toMatchObject({ reason: 'not-ours' });
  });

  it('an answer the list signed with this call’s nonce, but for another computer, op or version', async () => {
    const s = await stand();
    const c = clientOf(s, 'client-resigned');
    const resign =
      (change: (p: Record<string, unknown>) => void) => (a: { payload: string; sig: string }) => {
        const p = JSON.parse(a.payload) as Record<string, unknown>;
        change(p);
        const payload = JSON.stringify(p);
        return {
          payload,
          sig: sign('sha256', Buffer.from(payload), s.list.keys.privateKey).toString('base64'),
        };
      };
    s.tamper = resign(() => undefined);
    expect(await c.status(PERSON)).toMatchObject({ ok: true });
    s.tamper = resign((p) => {
      p['computerId'] = 'e'.repeat(64);
    });
    expect(await c.status(PERSON)).toMatchObject({ ok: false, kind: 'no-answer', reason: 'not-ours' });
    s.tamper = resign((p) => {
      p['op'] = 'check';
    });
    expect(await c.status(PERSON)).toMatchObject({ reason: 'not-ours' });
    s.tamper = resign((p) => {
      p['v'] = 2;
    });
    expect(await c.status(PERSON)).toMatchObject({ reason: 'not-ours' });
    s.tamper = resign((p) => {
      p['status'] = 'in';
    });
    expect(await c.status(PERSON)).toMatchObject({ reason: 'unexpected' });
    s.tamper = resign((p) => {
      p['ok'] = false;
      p['error'] = 'no-such-refusal';
    });
    expect(await c.status(PERSON)).toMatchObject({ reason: 'unexpected' });
  });

  it('an error page, no answer in time, or no list there', async () => {
    const s = await stand();
    const c = clientOf(s, 'client-limits', { timeoutMs: 300 });
    s.mode = 'error';
    expect(await c.status(PERSON)).toMatchObject({ ok: false, kind: 'no-answer', reason: 'http' });
    s.mode = 'silent';
    const started = Date.now();
    expect(await c.status(PERSON)).toMatchObject({ reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(5000);
    const url = s.url;
    s.mode = 'answer';
    await s.close();
    standIn = null;
    const gone = new AccessClient({
      url,
      publicKey: s.publicKey,
      computer: placeholderComputer('client-gone'),
      transport: nodeTransport,
      local: true,
    });
    expect(await gone.status(PERSON)).toMatchObject({ reason: 'network' });
  });
});

/** "Google", in this process: the list's own rules behind its HTTPS addresses, with one redirect. */
function google(
  list: TestList,
  redirectTo = 'https://script.googleusercontent.com/macros/echo?user_content_key=x',
) {
  const asked: string[] = [];
  let answer = '';
  const reply = (status: number, location: string | null, text = ''): AccessReply => ({
    status,
    location,
    text: () => Promise.resolve(text),
    cancel: () => undefined,
  });
  const transport: AccessTransport = ({ method, url, body }) => {
    asked.push(`${method} ${url}`);
    if (method === 'POST') {
      answer = JSON.stringify(list.handle(body ?? ''));
      return Promise.resolve(reply(302, redirectTo));
    }
    return Promise.resolve(reply(200, null, answer));
  };
  return { transport, asked };
}

describe('where Drashti asks', () => {
  it('the list’s own HTTPS address, following its redirect to Google’s answer', async () => {
    const list = new TestList();
    const g = google(list);
    const c = new AccessClient({
      url: GOOGLE,
      publicKey: list.keys.publicKey,
      computer: placeholderComputer('g'),
      transport: g.transport,
    });
    expect(value(await c.status(PERSON))).toEqual({ status: 'unknown', tokenWaiting: false });
    expect(g.asked).toEqual([
      `POST ${GOOGLE}`,
      'GET https://script.googleusercontent.com/macros/echo?user_content_key=x',
    ]);
  });

  it('never anywhere else: not over HTTP, not another address, not sent on away from Google', async () => {
    const list = new TestList();
    for (const url of [
      GOOGLE.replace('https:', 'http:'),
      'https://script.google.com.example.com/macros/s/AKfycbMadeUp0123/exec',
      'https://example.com/macros/s/AKfycbMadeUp0123/exec',
      'http://127.0.0.1:9/macros/s/stand-in/exec',
      GOOGLE.replace('/exec', '/dev'),
    ]) {
      const g = google(list);
      const c = new AccessClient({
        url,
        publicKey: list.keys.publicKey,
        computer: placeholderComputer('h'),
        transport: g.transport,
      });
      expect(await c.status(PERSON)).toMatchObject({ ok: false, kind: 'no-answer', reason: 'address' });
      expect(g.asked).toEqual([]);
    }
    for (const away of [
      'https://example.com/macros/echo',
      'http://script.googleusercontent.com/macros/echo',
      'https://script.googleusercontent.com.example.com/x',
    ]) {
      const g = google(list, away);
      const c = new AccessClient({
        url: GOOGLE,
        publicKey: list.keys.publicKey,
        computer: placeholderComputer('r'),
        transport: g.transport,
      });
      expect(await c.status(PERSON)).toMatchObject({ ok: false, kind: 'no-answer', reason: 'redirect' });
      expect(g.asked).toHaveLength(1);
    }
  });

  it('the stand-in only from the test switches, never in a packaged Drashti', () => {
    const key = new TestList().keys.publicKey;
    const env = {
      DRASHTI_TEST_ACCESS_URL: 'http://127.0.0.1:4567/macros/s/stand-in/exec',
      DRASHTI_TEST_ACCESS_KEY: key,
    };
    expect(accessTarget({ packaged: false, switches: switchesFor(false, env) })).toEqual({
      url: env.DRASHTI_TEST_ACCESS_URL,
      publicKey: key,
      local: true,
    });
    // Packaged: the switches are never read, and the list built in is the one asked (placeholders are no list to
    // ask: none until the owner's is put in for the release).
    const builtIn = accessConfigReal()
      ? { url: ACCESS_LIST_URL, publicKey: ACCESS_LIST_PUBLIC_KEY, local: false }
      : null;
    expect(accessTarget({ packaged: true, switches: switchesFor(true, env) })).toEqual(builtIn);
    expect(
      accessTarget({ packaged: true, switches: (name) => (env as Record<string, string>)[name] }),
    ).toEqual(builtIn);
    expect(accessTarget({ packaged: false, switches: switchesFor(false, {}) })).toEqual(builtIn);
    for (const url of [
      'http://192.0.2.1:4567/x',
      'http://localhost:4567/x',
      'https://127.0.0.1:4567/x',
      'not a url',
    ])
      expect(
        accessTarget({
          packaged: false,
          switches: switchesFor(false, { ...env, DRASHTI_TEST_ACCESS_URL: url }),
        }),
      ).toBeNull();
    expect(
      accessTarget({
        packaged: false,
        switches: switchesFor(false, { ...env, DRASHTI_TEST_ACCESS_KEY: 'x' }),
      }),
    ).toBeNull();
  });

  it('a local client asks only its own 127.0.0.1 address, even when sent on', async () => {
    const s = await stand();
    const c = clientOf(s, 'client-local', {
      transport: (request) =>
        request.method === 'POST'
          ? Promise.resolve({
              status: 302,
              location: 'http://127.0.0.1:9/elsewhere',
              text: () => Promise.resolve(''),
              cancel: () => undefined,
            })
          : nodeTransport(request),
    });
    expect(await c.status(PERSON)).toMatchObject({ ok: false, kind: 'no-answer', reason: 'redirect' });
  });

  it('refuses a public key that is not an RSA key', () => {
    const ed = generateKeyPairSync('ed25519')
      .publicKey.export({ type: 'spki', format: 'der' })
      .toString('base64');
    expect(
      () =>
        new AccessClient({
          url: GOOGLE,
          publicKey: ed,
          computer: placeholderComputer('k'),
          transport: nodeTransport,
        }),
    ).toThrow(/RSA/u);
  });
});
