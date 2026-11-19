import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { callGoogle, type CallOptions, type GoogleEndpoints } from './google-transport';

/*
 * Signing in to YouTube (x31), as Google documents it for a desktop app (OAuth 2.0 for iOS & Desktop apps): the
 * computer's own browser opens Google's page (shell.openExternal: the person signs in there, never Drashti), and
 * Google sends the browser back to a listener of Drashti's on a loopback address, http://127.0.0.1:<a free port>,
 * with a code that only this sign-in's PKCE verifier can turn into tokens. `state` ties the answer to this sign-in.
 *
 * The listener takes GETs on its own address only, answers each with a small page with no script, takes one answer
 * with the right state, and closes: after it, after 5 minutes, or on Cancel. Nothing it hears is logged.
 */

/** The one permission asked: schedule, bind and end broadcasts ("Manage your YouTube account"). */
export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube';
/** How long Drashti waits for the person to finish in the browser. */
export const SIGN_IN_WAIT_MS = 5 * 60_000;

export type RandomBytes = (size: number) => Buffer;

export interface Pkce {
  /** 64 characters of letters, digits, - and _ (PKCE allows 43 to 128 of these). */
  verifier: string;
  /** BASE64URL(SHA-256(verifier)), sent with method S256. */
  challenge: string;
}

export const challengeOf = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

export function makePkce(random: RandomBytes = randomBytes): Pkce {
  const verifier = random(48).toString('base64url');
  return { verifier, challenge: challengeOf(verifier) };
}

/** A new random state for one sign-in. */
export const newState = (random: RandomBytes = randomBytes): string => random(24).toString('base64url');

/** Google's sign-in page for this sign-in. */
export function signInAddress(
  endpoints: GoogleEndpoints,
  {
    clientId,
    redirectUri,
    challenge,
    state,
  }: { clientId: string; redirectUri: string; challenge: string; state: string },
): string {
  const url = new URL(endpoints.auth);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', YOUTUBE_SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  return url.toString();
}

/** What the browser brought back to Drashti's listener. */
export type BrowserAnswer =
  { ok: true; code: string } | { ok: false; reason: 'denied' | 'failed' | 'timeout' | 'cancelled' };

export interface BrowserListener {
  /** Where Google sends the browser back: http://127.0.0.1:<port>. */
  redirectUri: string;
  /** The one answer (or the wait ending without one). Never rejects. */
  answer: Promise<BrowserAnswer>;
  /** Stop waiting: the answer becomes `cancelled` (nothing if it already came). */
  cancel(): void;
}

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  connection: 'close',
} as const;

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/gu, (c) => `&#${String(c.codePointAt(0) ?? 0)};`);

/** The page the browser shows after Google sends it back: no script, nothing fetched. */
export function answerPage(title: string, words: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Drashti</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(words)}</p></body></html>`;
}

/** The longest code taken (Google's are a few hundred characters). */
const MAX_CODE = 4096;

/** Listen on 127.0.0.1 (a free port) for the browser coming back from Google with this state. */
export function listenForBrowser(state: string, waitMs = SIGN_IN_WAIT_MS): Promise<BrowserListener> {
  return new Promise((resolve, reject) => {
    let finish: (answer: BrowserAnswer) => void = () => undefined;
    const answer = new Promise<BrowserAnswer>((done) => {
      finish = done;
    });
    let over = false;
    const page = (res: ServerResponse, status: number, title: string, words: string) => {
      res.writeHead(status, PAGE_HEADERS);
      res.end(answerPage(title, words));
    };
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        page(res, 405, 'Not here', 'This address is only for coming back from Google’s sign-in page.');
        return;
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/') {
        page(res, 404, 'Not here', 'This address is only for coming back from Google’s sign-in page.');
        return;
      }
      if (over) {
        page(res, 410, 'Already finished', 'Go back to Drashti.');
        return;
      }
      if (url.searchParams.get('state') !== state) {
        page(
          res,
          400,
          'Not this sign-in',
          'This is not the sign-in Drashti is waiting for. Go back to Drashti and choose Sign in to YouTube again.',
        );
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (error !== null) {
        page(res, 200, 'Not signed in', 'Nothing changed. Go back to Drashti to try again.');
        end({ ok: false, reason: error === 'access_denied' ? 'denied' : 'failed' });
        return;
      }
      if (code === null || code === '' || code.length > MAX_CODE) {
        page(res, 400, 'Not signed in', 'Google’s answer did not read. Go back to Drashti to try again.');
        end({ ok: false, reason: 'failed' });
        return;
      }
      page(res, 200, 'Signed in to YouTube', 'You can close this tab and go back to Drashti.');
      end({ ok: true, code });
    });
    const timer = setTimeout(() => {
      end({ ok: false, reason: 'timeout' });
    }, waitMs);
    timer.unref();
    function end(result: BrowserAnswer): void {
      if (over) return;
      over = true;
      clearTimeout(timer);
      finish(result);
      // Its own answer goes first: then the listener closes, with every connection.
      setImmediate(() => {
        server.close();
        server.closeAllConnections();
      });
    }
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        redirectUri: `http://127.0.0.1:${String(port)}`,
        answer,
        cancel: () => {
          end({ ok: false, reason: 'cancelled' });
        },
      });
    });
  });
}

/** Why a token could not be had. */
export type TokenProblem =
  | 'offline'
  | 'guard'
  /** A refresh token Google no longer takes (revoked, unused for 6 months, a Testing project's 7 days). */
  | 'signed-out'
  /** The code was not taken (out of date, used, or the verifier did not match). */
  | 'sign-in-failed'
  | 'bad-client'
  /** Signed in, but the YouTube permission was not ticked on Google's page. */
  | 'no-scope'
  | 'unavailable'
  | 'refused';

export type TokenAnswer =
  | { ok: true; accessToken: string; expiresAt: number; refreshToken: string | null }
  | { ok: false; problem: TokenProblem; detail: string | null };

const tokenSchema = z.object({
  access_token: z.string().min(1).max(8192),
  expires_in: z
    .number()
    .positive()
    .max(7 * 86_400),
  refresh_token: z.string().min(1).max(8192).optional(),
  scope: z.string().max(8192).optional(),
});

const tokenErrorSchema = z.object({
  error: z.string().max(200),
  error_description: z.string().max(2000).optional(),
});

const FORM = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } as const;

async function tokenCall(
  endpoints: GoogleEndpoints,
  call: CallOptions,
  form: Record<string, string>,
  now: number,
  rejected: TokenProblem,
): Promise<TokenAnswer> {
  const reply = await callGoogle(
    { method: 'POST', url: endpoints.token, headers: FORM, body: new URLSearchParams(form).toString() },
    call,
  );
  if (!reply.reached) return { ok: false, problem: reply.guard ? 'guard' : 'offline', detail: null };
  if (reply.status === 200) {
    const tokens = tokenSchema.safeParse(reply.json);
    if (!tokens.success) return { ok: false, problem: 'unavailable', detail: null };
    const scopes = tokens.data.scope?.split(' ');
    if (scopes && !scopes.includes(YOUTUBE_SCOPE)) return { ok: false, problem: 'no-scope', detail: null };
    return {
      ok: true,
      accessToken: tokens.data.access_token,
      expiresAt: now + tokens.data.expires_in * 1000,
      refreshToken: tokens.data.refresh_token ?? null,
    };
  }
  if (reply.status >= 500) return { ok: false, problem: 'unavailable', detail: null };
  const error = tokenErrorSchema.safeParse(reply.json);
  const code = error.success ? error.data.error : null;
  if (code === 'invalid_grant') return { ok: false, problem: rejected, detail: null };
  if (code === 'invalid_client' || code === 'unauthorized_client')
    return { ok: false, problem: 'bad-client', detail: null };
  return {
    ok: false,
    problem: 'refused',
    detail: error.success ? (error.data.error_description ?? null) : null,
  };
}

/** Turn the browser's code into tokens (with this sign-in's verifier). */
export function exchangeCode(
  endpoints: GoogleEndpoints,
  call: CallOptions,
  input: { code: string; clientId: string; clientSecret: string; redirectUri: string; verifier: string },
  now: number,
): Promise<TokenAnswer> {
  return tokenCall(
    endpoints,
    call,
    {
      grant_type: 'authorization_code',
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    },
    now,
    'sign-in-failed',
  );
}

/** A new access token from the kept refresh token. */
export function refreshAccess(
  endpoints: GoogleEndpoints,
  call: CallOptions,
  input: { clientId: string; clientSecret: string; refreshToken: string },
  now: number,
): Promise<TokenAnswer> {
  return tokenCall(
    endpoints,
    call,
    {
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    },
    now,
    'signed-out',
  );
}
