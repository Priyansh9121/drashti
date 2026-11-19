import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  googleStandIn,
  STANDIN_CLIENT_ID,
  STANDIN_CLIENT_SECRET,
  type GoogleStandIn,
} from '../../../tests/youtube-standin';
import {
  challengeOf,
  exchangeCode,
  listenForBrowser,
  makePkce,
  newState,
  refreshAccess,
  signInAddress,
  YOUTUBE_SCOPE,
  type BrowserListener,
} from './google-sign-in';
import {
  GOOGLE_ENDPOINTS,
  nodeGoogleTransport,
  standInEndpoints,
  type GoogleTransport,
} from './google-transport';

/*
 * Signing in to YouTube as Google documents it for a desktop app (x31): the computer's own browser, a listener on
 * 127.0.0.1 for its way back, PKCE (S256) and state; against the tests' stand-in for Google on 127.0.0.1 only.
 */

let standIn: GoogleStandIn | null = null;
const listeners: BrowserListener[] = [];
afterEach(async () => {
  for (const l of listeners.splice(0)) l.cancel();
  await standIn?.close();
  standIn = null;
});

const call = { transport: nodeGoogleTransport, onlyThisComputer: true };

async function stand(): Promise<GoogleStandIn> {
  standIn = await googleStandIn({ ingestion: 'rtmp://127.0.0.1:1935/live2' });
  return standIn;
}

async function listen(state: string, waitMs?: number): Promise<BrowserListener> {
  const l = await listenForBrowser(state, waitMs);
  listeners.push(l);
  return l;
}

describe('PKCE and the sign-in address', () => {
  it('makes a 64-character verifier and its S256 challenge (RFC 7636’s own example)', () => {
    const { verifier, challenge } = makePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{64}$/u);
    expect(challenge).toBe(challengeOf(verifier));
    expect(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    expect(newState()).not.toBe(newState());
  });

  it('asks Google for a code, the YouTube permission alone, with the challenge and state', () => {
    const url = new URL(
      signInAddress(GOOGLE_ENDPOINTS, {
        clientId: STANDIN_CLIENT_ID,
        redirectUri: 'http://127.0.0.1:50123',
        challenge: 'c'.repeat(43),
        state: 's1',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: STANDIN_CLIENT_ID,
      redirect_uri: 'http://127.0.0.1:50123',
      response_type: 'code',
      scope: YOUTUBE_SCOPE,
      code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256',
      state: 's1',
    });
  });
});

describe('the listener for the browser’s way back', () => {
  it('listens on 127.0.0.1 only, takes the answer with this sign-in’s state, and answers a page with no script', async () => {
    const l = await listen('right-state');
    expect(l.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    const wrong = await fetch(`${l.redirectUri}/?state=other&code=abc`);
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toContain('This is not the sign-in Drashti is waiting for');
    expect((await fetch(`${l.redirectUri}/favicon.ico`)).status).toBe(404);
    expect((await fetch(`${l.redirectUri}/?state=right-state&code=abc`, { method: 'POST' })).status).toBe(
      405,
    );
    const right = await fetch(`${l.redirectUri}/?state=right-state&code=the-code`);
    expect(right.status).toBe(200);
    expect(right.headers.get('content-security-policy')).toBe("default-src 'none'");
    const page = await right.text();
    expect(page).toContain('Signed in to YouTube');
    expect(page).not.toMatch(/<script/iu);
    expect(await l.answer).toEqual({ ok: true, code: 'the-code' });
    // Closed after its one answer.
    await expect(fetch(`${l.redirectUri}/?state=right-state&code=again`)).rejects.toThrow();
  });

  it('hears a refusal, a cancel and the wait running out, each as itself', async () => {
    const denied = await listen('s');
    await fetch(`${denied.redirectUri}/?state=s&error=access_denied`);
    expect(await denied.answer).toEqual({ ok: false, reason: 'denied' });
    const cancelled = await listen('s');
    cancelled.cancel();
    expect(await cancelled.answer).toEqual({ ok: false, reason: 'cancelled' });
    const late = await listen('s', 50);
    expect(await late.answer).toEqual({ ok: false, reason: 'timeout' });
  });
});

describe('tokens, from the stand-in for Google', () => {
  async function codeFor(s: GoogleStandIn, verifierFor: string) {
    const l = await listen('st');
    const address = signInAddress(standInEndpoints(s.base), {
      clientId: STANDIN_CLIENT_ID,
      redirectUri: l.redirectUri,
      challenge: challengeOf(verifierFor),
      state: 'st',
    });
    const browsed = await s.browse(address);
    expect(browsed.reachedDrashti).toBe(true);
    const answer = await l.answer;
    if (!answer.ok) throw new Error('no code');
    return { code: answer.code, redirectUri: l.redirectUri };
  }

  it('turns the code into tokens only with this sign-in’s verifier, once', async () => {
    const s = await stand();
    const endpoints = standInEndpoints(s.base);
    const { verifier } = makePkce();
    const first = await codeFor(s, verifier);
    const client = { clientId: STANDIN_CLIENT_ID, clientSecret: STANDIN_CLIENT_SECRET };
    const got = await exchangeCode(endpoints, call, { ...first, ...client, verifier }, 1_000);
    expect(got).toMatchObject({ ok: true, expiresAt: 1_000 + 3_599_000 });
    if (!got.ok) return;
    expect(got.refreshToken).toMatch(/^test-made-up-refresh-token-/u);
    // The same code again, or another sign-in's verifier: not taken.
    expect(await exchangeCode(endpoints, call, { ...first, ...client, verifier }, 1_000)).toEqual({
      ok: false,
      problem: 'sign-in-failed',
      detail: null,
    });
    const second = await codeFor(s, verifier);
    expect(
      await exchangeCode(endpoints, call, { ...second, ...client, verifier: makePkce().verifier }, 1_000),
    ).toEqual({ ok: false, problem: 'sign-in-failed', detail: null });
    // A client Google does not know.
    const third = await codeFor(s, verifier);
    expect(
      await exchangeCode(
        endpoints,
        call,
        { ...third, ...client, clientSecret: 'another-made-up', verifier },
        1_000,
      ),
    ).toEqual({ ok: false, problem: 'bad-client', detail: null });
    // A new access token from the refresh token, until Google stops taking it.
    const renewed = await refreshAccess(
      endpoints,
      call,
      { ...client, refreshToken: got.refreshToken ?? '' },
      5_000,
    );
    expect(renewed).toMatchObject({ ok: true, expiresAt: 5_000 + 3_599_000, refreshToken: null });
    s.refuseRefreshTokens();
    expect(
      await refreshAccess(endpoints, call, { ...client, refreshToken: got.refreshToken ?? '' }, 5_000),
    ).toEqual({ ok: false, problem: 'signed-out', detail: null });
  });

  it('says when the YouTube permission was not ticked, and when Google cannot be reached', async () => {
    const s = await stand();
    const endpoints = standInEndpoints(s.base);
    s.grantedScope = 'openid';
    const { verifier } = makePkce();
    const got = await codeFor(s, verifier);
    const client = { clientId: STANDIN_CLIENT_ID, clientSecret: STANDIN_CLIENT_SECRET };
    expect(await exchangeCode(endpoints, call, { ...got, ...client, verifier }, 0)).toEqual({
      ok: false,
      problem: 'no-scope',
      detail: null,
    });
    s.mode = 'offline';
    expect(await refreshAccess(endpoints, call, { ...client, refreshToken: 'x' }, 0)).toEqual({
      ok: false,
      problem: 'offline',
      detail: null,
    });
  });

  it('under the tests’ guard, sends nothing to an address off this computer (Google’s own)', async () => {
    const transport = vi.fn<GoogleTransport>();
    const warn = vi.fn();
    const got = await refreshAccess(
      GOOGLE_ENDPOINTS,
      { transport, onlyThisComputer: true, warn },
      { clientId: STANDIN_CLIENT_ID, clientSecret: STANDIN_CLIENT_SECRET, refreshToken: 'x' },
      0,
    );
    expect(got).toEqual({ ok: false, problem: 'guard', detail: null });
    expect(transport).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'TEST GUARD: a call to oauth2.googleapis.com was refused: not 127.0.0.1',
    );
  });
});
