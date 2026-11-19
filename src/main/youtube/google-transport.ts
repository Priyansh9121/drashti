/*
 * Drashti's requests to Google (x31): the sign-in's token endpoint and the YouTube Data API, from the main process
 * only. One request at a time, never following a redirect (Google's endpoints answer without one), no
 * cookies, a time limit on each, and an answer read only up to a size. Drashti uses Electron's network stack
 * (electron-google-transport.ts: the computer's proxy settings and certificate store); the unit tests Node's own.
 *
 * Google's real addresses are fixed here. The tests' stand-in for Google (tests/youtube-standin.ts, on 127.0.0.1) is
 * reached only through DRASHTI_TEST_GOOGLE_STANDIN, which a packaged Drashti never reads (src/main/switches.ts), and
 * under the guard every end-to-end run sets (DRASHTI_TEST_LINK_GUARD) any other address is refused before a byte is
 * sent, loudly: no test ever reaches Google or YouTube.
 */

export interface GoogleRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Readonly<Record<string, string>>;
  /** A form or JSON text for a POST; null for none. */
  body: string | null;
  signal: AbortSignal;
}

export interface GoogleReply {
  status: number;
  /** The body as text, refused (it throws) past `maxChars`. */
  text(maxChars: number): Promise<string>;
}

/** One request, its redirect never followed. */
export type GoogleTransport = (request: GoogleRequest) => Promise<GoogleReply>;

/** Node's own fetch: the unit tests'. */
export const nodeGoogleTransport: GoogleTransport = async ({ method, url, headers, body, signal }) => {
  const response = await fetch(url, { method, headers, body, signal, redirect: 'manual' });
  return {
    status: response.status,
    text: async (maxChars) => {
      const text = await response.text();
      if (text.length > maxChars) throw new Error('The answer is too long.');
      return text;
    },
  };
};

/** Where Drashti signs in and calls YouTube. */
export interface GoogleEndpoints {
  /** Google's sign-in page, opened in the computer's own browser. */
  auth: string;
  token: string;
  /** The YouTube Data API v3. */
  api: string;
}

/** Google's own (OAuth 2.0 for desktop apps; the YouTube Data API v3). */
export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  api: 'https://www.googleapis.com/youtube/v3',
};

/** The tests' stand-in for Google at this base (http://127.0.0.1:<port>), at the same paths as Google's. */
export function standInEndpoints(base: string): GoogleEndpoints {
  const root = base.replace(/\/+$/u, '');
  return {
    auth: `${root}/o/oauth2/v2/auth`,
    token: `${root}/token`,
    api: `${root}/youtube/v3`,
  };
}

/** An address on this computer (the tests' guard allows only these). */
export function onThisComputer(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/** Every call ends within this. */
export const GOOGLE_CALL_TIMEOUT_MS = 20_000;
/** An answer is read only up to this size (a list of 25 broadcasts is a few tens of KB). */
const MAX_ANSWER_CHARS = 2 * 1024 * 1024;

export type GoogleCall =
  | { reached: true; status: number; json: unknown }
  /** No answer: the network, a time limit, or the tests' guard (`guard`). */
  | { reached: false; guard: boolean };

export interface CallOptions {
  transport: GoogleTransport;
  /** Tests: only 127.0.0.1 (DRASHTI_TEST_LINK_GUARD). */
  onlyThisComputer: boolean;
  timeoutMs?: number;
  /** Said loudly when the tests' guard refuses an address (never the address's query). */
  warn?(message: string): void;
}

/** One request to Google: its JSON answer (null when the body is not JSON), or no answer. Never throws. */
export async function callGoogle(
  request: Omit<GoogleRequest, 'signal'>,
  options: CallOptions,
): Promise<GoogleCall> {
  if (options.onlyThisComputer && !onThisComputer(request.url)) {
    options.warn?.(`TEST GUARD: a call to ${hostOf(request.url)} was refused: not 127.0.0.1`);
    return { reached: false, guard: true };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? GOOGLE_CALL_TIMEOUT_MS);
  try {
    const reply = await options.transport({ ...request, signal: controller.signal });
    const text = await reply.text(MAX_ANSWER_CHARS);
    let json: unknown = null;
    try {
      json = text === '' ? null : (JSON.parse(text) as unknown);
    } catch {
      json = null;
    }
    return { reached: true, status: reply.status, json };
  } catch {
    return { reached: false, guard: false };
  } finally {
    clearTimeout(timer);
  }
}

/** An address's host alone, for the log: never its path or query (a token or a code may be in it). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'an address that does not read';
  }
}
