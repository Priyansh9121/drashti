import type { CallOptions, GoogleEndpoints } from './google-transport';

/*
 * Signing in to YouTube (x31): not built yet. The red tests beside this name what it must do.
 */

export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube';
export const SIGN_IN_WAIT_MS = 5 * 60_000;

export type RandomBytes = (size: number) => Buffer;

export interface Pkce {
  verifier: string;
  challenge: string;
}

const notYet = (): never => {
  throw new Error('Signing in to YouTube is not built yet.');
};

export const challengeOf = (_verifier: string): string => notYet();
export const makePkce = (_random?: RandomBytes): Pkce => notYet();
export const newState = (_random?: RandomBytes): string => notYet();
export const signInAddress = (
  _endpoints: GoogleEndpoints,
  _input: { clientId: string; redirectUri: string; challenge: string; state: string },
): string => notYet();

export type BrowserAnswer =
  { ok: true; code: string } | { ok: false; reason: 'denied' | 'failed' | 'timeout' | 'cancelled' };

export interface BrowserListener {
  redirectUri: string;
  answer: Promise<BrowserAnswer>;
  cancel(): void;
}

export const answerPage = (_title: string, _words: string): string => notYet();
export const listenForBrowser = (_state: string, _waitMs?: number): Promise<BrowserListener> =>
  Promise.reject(new Error('Signing in to YouTube is not built yet.'));

export type TokenProblem =
  | 'offline'
  | 'guard'
  | 'signed-out'
  | 'sign-in-failed'
  | 'bad-client'
  | 'no-scope'
  | 'unavailable'
  | 'refused';

export type TokenAnswer =
  | { ok: true; accessToken: string; expiresAt: number; refreshToken: string | null }
  | { ok: false; problem: TokenProblem; detail: string | null };

export const exchangeCode = (
  _endpoints: GoogleEndpoints,
  _call: CallOptions,
  _input: { code: string; clientId: string; clientSecret: string; redirectUri: string; verifier: string },
  _now: number,
): Promise<TokenAnswer> => Promise.reject(new Error('Signing in to YouTube is not built yet.'));

export const refreshAccess = (
  _endpoints: GoogleEndpoints,
  _call: CallOptions,
  _input: { clientId: string; clientSecret: string; refreshToken: string },
  _now: number,
): Promise<TokenAnswer> => Promise.reject(new Error('Signing in to YouTube is not built yet.'));
