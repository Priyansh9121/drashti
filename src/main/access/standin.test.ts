import { createHash, createHmac, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  callBody,
  linkParams,
  PLACEHOLDER_APPROVER,
  placeholderComputer,
  readAnswer,
  type LinkPageAnswer,
} from '../../../tests/access-core';
import { accessStandIn, type AccessStandIn } from '../../../tests/access-standin';
import { canonicalJson } from '../../shared/access-protocol';

/*
 * The stand-in list on 127.0.0.1 that every end-to-end test lets Drashti in through (Session 54, E1,
 * tests/access-standin.ts): it answers as Google's web app does, redirect and all, with the list's own rules.
 */

const PERSON = 'placeholder.user@example.com';
let standIn: AccessStandIn | null = null;

afterEach(async () => {
  await standIn?.close();
  standIn = null;
});

/** A POST as Drashti makes it, following the one redirect by hand. */
async function post(s: AccessStandIn, text: string): Promise<{ payload: string; sig: string }> {
  const first = await fetch(s.url, { method: 'POST', body: text, redirect: 'manual' });
  expect(first.status).toBe(302);
  const location = first.headers.get('location') ?? '';
  expect(location.startsWith('http://127.0.0.1:')).toBe(true);
  const second = await fetch(location, { redirect: 'manual' });
  expect(second.status).toBe(200);
  // The answer's address works once, as Google's does.
  expect((await fetch(location)).status).toBe(404);
  return (await second.json()) as { payload: string; sig: string };
}

/**
 * A call from the link page (x38), as its browser sends it from its own site: plain text, the redirect followed, and
 * each answer open to any site (Access-Control-Allow-Origin: *, as Google's).
 */
async function pageCall(
  s: AccessStandIn,
  link: string,
  call: 'read' | 'answer',
  fields: Record<string, string> = {},
): Promise<LinkPageAnswer['page']> {
  const text = JSON.stringify({ link: call, ...linkParams(link), ...fields });
  const first = await fetch(s.url, { method: 'POST', body: text, redirect: 'manual' });
  expect(first.status).toBe(302);
  expect(first.headers.get('access-control-allow-origin')).toBe('*');
  const second = await fetch(first.headers.get('location') ?? '', { redirect: 'manual' });
  expect(second.status).toBe(200);
  expect(second.headers.get('access-control-allow-origin')).toBe('*');
  const answer = readAnswer((await second.json()) as { payload: string; sig: string }, s.publicKey);
  return (answer as unknown as LinkPageAnswer).page;
}

describe('the stand-in list', () => {
  it('answers on 127.0.0.1 as the web app does, signed, and its links open the link page on a site of its own, whose calls carry no cookie', async () => {
    const s = (standIn = await accessStandIn());
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/macros\/s\/stand-in\/exec$/u);
    const computer = placeholderComputer('stand-in-mac');
    const ask = callBody('request', computer, { gmail: PERSON, name: 'Placeholder Person' });
    const a = readAnswer(await post(s, JSON.stringify(ask.body)), s.publicKey);
    expect(a).toMatchObject({ ok: true, status: 'requested', nonce: ask.nonce, computerId: computer.id });
    expect(s.calls).toEqual(['request']);

    const approve = s.list.linksFor(PERSON)?.approve ?? '';
    // The link page, as GitHub Pages serves the real one: another site, with the stand-in's address for the list's.
    expect(approve).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/drashti\/access\/#a=approve&r=[0-9a-f]{32}&x=\d+&s=[0-9a-f]{64}$/u,
    );
    expect(new URL(approve).origin).not.toBe(new URL(s.url).origin);
    const html = await (await fetch(approve)).text();
    expect(html).toContain(`data-list="${s.url}"`);
    expect(html).toContain(`connect-src ${new URL(s.url).origin};`);
    expect(html).not.toContain('script.google.com');
    expect((await fetch(new URL('/drashti/other/', approve))).status).toBe(404);
    // Its two calls: read changes nothing, answer is its one button.
    expect(await pageCall(s, approve, 'read')).toMatchObject({ kind: 'ready', button: 'Approve' });
    expect(s.list.tokenFor(PERSON)).toBeNull();
    expect(await pageCall(s, approve, 'answer')).toMatchObject({ kind: 'done', title: 'Approved' });
    expect(s.linkCalls).toEqual([
      { call: 'read', cookie: false },
      { call: 'answer', cookie: false },
    ]);
    // The page's calls are never Drashti's.
    expect(s.calls).toEqual(['request']);

    const token = s.list.tokenFor(PERSON) ?? '';
    const redeem = callBody('redeem', computer, { gmail: PERSON, token });
    const r = readAnswer(await post(s, JSON.stringify(redeem.body)), s.publicKey);
    expect(r).toMatchObject({ ok: true, owner: false });
  });

  it('serves the page a link sent before x38 opens (Link.html, as Apps Script makes it), whose button reaches the list with the length chosen', async () => {
    const s = (standIn = await accessStandIn());
    const computer = placeholderComputer('stand-in-page');
    await post(s, JSON.stringify(callBody('request', computer, { gmail: PERSON }).body));
    const approve = s.list.linksFor(PERSON)?.approve ?? '';
    const html = await (await fetch(s.pageUrl(approve))).text();
    // The page's lengths, Unlimited first, each a choice; its one button; google.script.run as the web app has it.
    expect(html).toContain('<legend>How long may they use Drashti?</legend>');
    expect(html).toContain('data-chosen="unlimited"');
    for (const v of ['unlimited', '1', '7', '30', '60', '90', '120', '180', '365', 'typed'])
      expect(html).toContain(`name="length" value="${v}"`);
    expect(html).toContain('max="730"');
    expect(html).toContain('<button id="go" type="button">Approve</button>');
    expect(html).toContain('window.google = { script: { run:');
    // Every text from the list is escaped as Apps Script's printer escapes it.
    expect(html).not.toMatch(/<\?|\?>/u);
    const params = linkParams(approve);
    const run = new URL('/macros/s/stand-in/run', s.url);
    const answer = async (length: string) =>
      (await (await fetch(run, { method: 'POST', body: JSON.stringify({ ...params, length }) })).json()) as {
        kind: string;
        title: string;
        lines: string[];
      };
    expect(await answer('0')).toMatchObject({ kind: 'refused', title: 'Not done' });
    const done = await answer('30');
    expect(done).toMatchObject({ kind: 'done', title: 'Approved' });
    expect(done.lines.join(' ')).toContain('Their access lasts until');
    expect(s.list.sheet.find('Access List', 'Gmail', PERSON)?.['Access ends']).toEqual(
      new Date(s.list.t + 30 * 24 * 3_600_000),
    );
    // A Reject page has no lengths.
    const reject = await (await fetch(s.pageUrl(s.list.linksFor(PERSON)?.reject ?? ''))).text();
    expect(reject).not.toContain('<legend>');
  });

  it('the Approve page offers Pro or Simple, Simple chosen first, and its button sends the one chosen (Session 55)', async () => {
    const s = (standIn = await accessStandIn());
    const computer = placeholderComputer('stand-in-page-mode');
    await post(s, JSON.stringify(callBody('request', computer, { gmail: PERSON }).body));
    const approve = s.list.linksFor(PERSON)?.approve ?? '';
    const html = await (await fetch(s.pageUrl(approve))).text();
    expect(html).toContain('<legend>What may they use?</legend>');
    expect(html).toContain('data-chosen-mode="simple"');
    for (const v of ['simple', 'pro']) expect(html).toContain(`name="mode" value="${v}"`);
    expect(html).toContain('Simple Mode only');
    expect(html).toContain('Pro Mode and Simple Mode');
    // The page's own script sends the mode chosen with the button.
    expect(html).toContain('params.mode = modeChosen()');
    const params = linkParams(approve);
    const run = new URL('/macros/s/stand-in/run', s.url);
    const done = (await (
      await fetch(run, {
        method: 'POST',
        body: JSON.stringify({ ...params, length: 'unlimited', mode: 'pro' }),
      })
    ).json()) as { kind: string; lines: string[] };
    expect(done).toMatchObject({ kind: 'done' });
    expect(s.list.sheet.find('Access List', 'Gmail', PERSON)?.['Mode']).toBe('Pro');
    // A Reject page offers no mode.
    const reject = await (await fetch(s.pageUrl(s.list.linksFor(PERSON)?.reject ?? ''))).text();
    expect(reject).not.toContain('id="modes"');
    expect(reject).not.toContain('<legend>What may they use?</legend>');
  });

  it('makes grants Pro unless a test asks for Simple, and learns a new mode as the owner gives one (Session 55)', async () => {
    const s = (standIn = await accessStandIn());
    const pro = placeholderComputer('stand-in-pro');
    const simple = placeholderComputer('stand-in-simple');
    const g1 = s.grant(PERSON, pro);
    const g2 = s.grant('simple.placeholder@example.com', simple, { mode: 'simple' });
    const check = async (grant: typeof g1, computer: typeof pro) =>
      readAnswer(
        await post(
          s,
          JSON.stringify(callBody('check', computer, { at: s.list.t, activity: {} }, grant).body),
        ),
        s.publicKey,
      );
    expect(await check(g1, pro)).toMatchObject({ status: 'in', mode: 'pro' });
    expect(await check(g2, simple)).toMatchObject({ status: 'in', mode: 'simple' });
    s.setMode('simple.placeholder@example.com', 'pro');
    s.list.move(6_000);
    expect(await check(g2, simple)).toMatchObject({ status: 'in', mode: 'pro' });
  });

  it('makes grants the real way, for a person, a second computer of theirs, and the owner', async () => {
    const s = (standIn = await accessStandIn());
    const one = placeholderComputer('stand-in-one');
    const two = placeholderComputer('stand-in-two');
    const g1 = s.grant(PERSON, one);
    const g2 = s.grant(PERSON, two);
    const owner = s.grant(PLACEHOLDER_APPROVER, placeholderComputer('stand-in-owner'));
    for (const [grant, computer, isOwner] of [
      [g1, one, false],
      [g2, two, false],
      [owner, placeholderComputer('stand-in-owner'), true],
    ] as const) {
      const c = callBody('check', computer, { at: s.list.t, activity: {} }, grant);
      expect(readAnswer(await post(s, JSON.stringify(c.body)), s.publicKey)).toMatchObject({
        ok: true,
        status: 'in',
        owner: isOwner,
      });
    }
  });

  it('takes a report of megabytes over HTTP as Google’s web app does (x49): answered, its files in the mailbox as they were sent', async () => {
    const s = (standIn = await accessStandIn());
    const computer = placeholderComputer('stand-in-report');
    const grant = s.grant(PERSON, computer);
    // Megabytes of a file, and words past ASCII, so a letter's bytes fall across the parts of the upload.
    const crash = Buffer.concat([Buffer.from('MDMP'), randomBytes(3 * 1024 * 1024)]);
    const sha = createHash('sha256').update(crash).digest('hex');
    const body: Record<string, unknown> = {
      v: 1,
      op: 'report',
      nonce: randomBytes(16).toString('hex'),
      computer,
      gmail: grant.gmail,
      grantId: grant.grantId,
      at: s.list.t,
      report: {
        id: randomBytes(16).toString('hex'),
        written: s.list.t,
        from: 'pro',
        features: [{ chapter: 'Stream', name: 'Going live', what: 'પ્લેસહોલ્ડર '.repeat(150).trim() }],
        files: [
          {
            kind: 'crash',
            name: '0f1e2d3c-placeholder.dmp',
            type: 'application/octet-stream',
            bytes: crash.length,
            sha256: sha,
          },
        ],
      },
    };
    body['mac'] = createHmac('sha256', Buffer.from(grant.secret, 'utf8'))
      .update(`drashti-access-v1\n${canonicalJson(body)}`, 'utf8')
      .digest('hex');
    body['data'] = { [sha]: crash.toString('base64') };
    const before = s.list.mailbox.length;
    expect(readAnswer(await post(s, JSON.stringify(body)), s.publicKey)).toMatchObject({
      ok: true,
      received: true,
    });
    expect(s.calls.at(-1)).toBe('report');
    const admin = s.list.mailbox[before];
    expect(admin?.to).toBe(PLACEHOLDER_APPROVER);
    expect(admin?.body).toContain('પ્લેસહોલ્ડર પ્લેસહોલ્ડર');
    expect(admin?.attachments?.[0]?.base64).toBe(crash.toString('base64'));
  });

  it('can say nothing, answer an error, leave answers unsigned, or answer at once without the redirect', async () => {
    const s = (standIn = await accessStandIn());
    const text = JSON.stringify(
      callBody('status', placeholderComputer('stand-in-modes'), { gmail: PERSON }).body,
    );
    s.mode = 'silent';
    await expect(
      fetch(s.url, { method: 'POST', body: text, signal: AbortSignal.timeout(300) }),
    ).rejects.toThrow();
    s.mode = 'error';
    expect((await fetch(s.url, { method: 'POST', body: text })).status).toBe(503);
    s.mode = 'unsigned';
    expect((await post(s, text)).sig).toBe('');
    s.mode = 'answer';
    s.redirect = false;
    const direct = await fetch(s.url, { method: 'POST', body: text, redirect: 'manual' });
    expect(direct.status).toBe(200);
    expect(readAnswer((await direct.json()) as { payload: string; sig: string }, s.publicKey)).toMatchObject({
      ok: true,
      status: 'unknown',
    });
  });
});
