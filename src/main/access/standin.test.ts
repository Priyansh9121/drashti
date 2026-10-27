import { afterEach, describe, expect, it } from 'vitest';
import { callBody, PLACEHOLDER_APPROVER, placeholderComputer, readAnswer } from '../../../tests/access-core';
import { accessStandIn, type AccessStandIn } from '../../../tests/access-standin';

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

describe('the stand-in list', () => {
  it('answers on 127.0.0.1 as the web app does, signed, and its links open a page with one button', async () => {
    const s = (standIn = await accessStandIn());
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/macros\/s\/stand-in\/exec$/u);
    const computer = placeholderComputer('stand-in-mac');
    const ask = callBody('request', computer, { gmail: PERSON, name: 'Placeholder Person' });
    const a = readAnswer(await post(s, JSON.stringify(ask.body)), s.publicKey);
    expect(a).toMatchObject({ ok: true, status: 'requested', nonce: ask.nonce, computerId: computer.id });
    expect(s.calls).toEqual(['request']);

    const links = s.list.linksFor(PERSON);
    expect(links?.approve.startsWith(s.url)).toBe(true);
    const page = await (await fetch(links?.approve ?? '')).text();
    expect(page).toContain('data-kind="ready"');
    expect(page).toContain('<button type="submit">Approve</button>');
    expect(s.list.tokenFor(PERSON)).toBeNull();
    const params = new URLSearchParams(new URL(links?.approve ?? '').search);
    const pressed = await (
      await fetch(new URL('/macros/s/stand-in/link', s.url), { method: 'POST', body: params })
    ).text();
    expect(pressed).toContain('<h1>Approved</h1>');

    const token = s.list.tokenFor(PERSON) ?? '';
    const redeem = callBody('redeem', computer, { gmail: PERSON, token });
    const r = readAnswer(await post(s, JSON.stringify(redeem.body)), s.publicKey);
    expect(r).toMatchObject({ ok: true, owner: false });
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
