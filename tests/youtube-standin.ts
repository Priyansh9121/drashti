import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/*
 * A stand-in for Google (x31), on 127.0.0.1 only, for the tests of scheduling a YouTube stream from Drashti: Google's
 * sign-in page (which "signs in" at once and sends the browser back to Drashti's listener, or refuses), its token
 * endpoint (the PKCE verifier checked against the challenge, the client, the address it came back to), and the YouTube
 * Data API calls Drashti makes (channels, liveBroadcasts insert, list, bind and transition, liveStreams insert and
 * list), answering as Google documents them, Google's error bodies included. A test can make it stop answering (no
 * internet), use up the day's quota, refuse live streaming, refuse its tokens, or start a broadcast as YouTube does
 * when its stream arrives. Nothing here reaches Google or YouTube: every client, token and stream key is made up here,
 * and `secrets()` lists them for the tests' search of what Drashti wrote.
 */

export const STANDIN_CLIENT_ID = '000000000000-drashtiplaceholder.apps.googleusercontent.com';
export const STANDIN_CLIENT_SECRET = 'test-made-up-client-secret-0000';
export const STANDIN_CHANNEL = 'Placeholder channel';
export const STANDIN_SCOPE = 'https://www.googleapis.com/auth/youtube';

/** How the stand-in answers: as Google, not at all (no internet), or with one of Google's refusals. */
export type GoogleMode = 'answer' | 'offline' | 'quota' | 'not-enabled' | 'server-error';

export interface FakeBroadcast {
  id: string;
  title: string;
  description: string;
  scheduledStartTime: string;
  privacyStatus: string;
  selfDeclaredMadeForKids: boolean | null;
  enableAutoStart: boolean | null;
  enableAutoStop: boolean | null;
  lifeCycleStatus: 'created' | 'ready' | 'testing' | 'liveStarting' | 'live' | 'complete' | 'revoked';
  boundStreamId: string | null;
}

export interface FakeStream {
  id: string;
  title: string;
  key: string;
  isReusable: boolean;
}

export interface GoogleStandIn {
  /** http://127.0.0.1:<port>: Drashti's DRASHTI_TEST_GOOGLE_STANDIN. */
  base: string;
  /** Each call as "METHOD /path" (never a token, a code or a key), in order. */
  calls: string[];
  broadcasts: Map<string, FakeBroadcast>;
  streams: Map<string, FakeStream>;
  mode: GoogleMode;
  /** What the person does on Google's page. */
  consent: 'allow' | 'deny';
  /** The permissions Google says were granted (the person may untick YouTube's). */
  grantedScope: string;
  /** The signed-in account has no channel. */
  noChannel: boolean;
  /** Where every stream's video goes (the test's FFmpeg listening on 127.0.0.1). */
  ingestion: string;
  /** Every access token so far stops working (as an hour passing does). */
  expireAccessTokens(): void;
  /** Every refresh token stops working (revoked, unused for 6 months, a Testing project's 7 days). */
  refuseRefreshTokens(): void;
  /** YouTube heard this stream key: a bound broadcast that starts by itself goes live. */
  streamArrived(key: string): void;
  /** A broadcast made elsewhere (in YouTube Studio), with no stream bound. */
  addBroadcast(fields: Partial<FakeBroadcast> & { title: string }): FakeBroadcast;
  /**
   * Plays the person's browser: opens the sign-in address (this stand-in's page), follows its answer back to Drashti's
   * listener, and gives Drashti's page.
   */
  browse(signInUrl: string): Promise<{ status: number; page: string; reachedDrashti: boolean }>;
  /** Every made-up secret given out so far (the client's, tokens and stream keys), for a search of Drashti's files. */
  secrets(): { label: string; value: string }[];
  close(): Promise<void>;
}

const made = (what: string): string => `test-made-up-${what}-${randomBytes(9).toString('base64url')}`;

const googleError = (code: number, reason: string, message: string) => ({
  error: { code, message, errors: [{ message, domain: 'youtube.liveBroadcast', reason }] },
});

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export async function googleStandIn(options: {
  ingestion: string;
  now?: () => number;
}): Promise<GoogleStandIn> {
  const now = options.now ?? Date.now;
  const codes = new Map<string, { challenge: string; redirectUri: string; used: boolean }>();
  const accessTokens = new Set<string>();
  const refreshTokens = new Set<string>();
  const given: { label: string; value: string }[] = [
    { label: 'the made-up client secret', value: STANDIN_CLIENT_SECRET },
  ];
  let next = 1;

  const broadcastResource = (b: FakeBroadcast) => ({
    kind: 'youtube#liveBroadcast',
    id: b.id,
    snippet: { title: b.title, description: b.description, scheduledStartTime: b.scheduledStartTime },
    status: {
      lifeCycleStatus: b.lifeCycleStatus,
      privacyStatus: b.privacyStatus,
      ...(b.selfDeclaredMadeForKids === null ? {} : { selfDeclaredMadeForKids: b.selfDeclaredMadeForKids }),
    },
    contentDetails: {
      ...(b.boundStreamId === null ? {} : { boundStreamId: b.boundStreamId }),
      enableAutoStart: b.enableAutoStart ?? false,
      enableAutoStop: b.enableAutoStop ?? false,
    },
  });
  const streamResource = (s: FakeStream) => ({
    kind: 'youtube#liveStream',
    id: s.id,
    snippet: { title: s.title },
    cdn: {
      ingestionType: 'rtmp',
      resolution: 'variable',
      frameRate: 'variable',
      ingestionInfo: {
        streamName: s.key,
        ingestionAddress: standIn.ingestion,
        rtmpsIngestionAddress: standIn.ingestion,
        backupIngestionAddress: standIn.ingestion,
      },
    },
    contentDetails: { isReusable: s.isReusable },
    status: { streamStatus: 'ready' },
  });

  async function token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = new URLSearchParams(await readBody(req));
    if (form.get('client_id') !== STANDIN_CLIENT_ID || form.get('client_secret') !== STANDIN_CLIENT_SECRET) {
      send(res, 401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' });
      return;
    }
    const issue = (withRefresh: boolean) => {
      const access = made('access-token');
      accessTokens.add(access);
      given.push({ label: 'a made-up access token', value: access });
      const out: Record<string, unknown> = {
        access_token: access,
        expires_in: 3599,
        scope: standIn.grantedScope,
        token_type: 'Bearer',
      };
      if (withRefresh) {
        const refresh = made('refresh-token');
        refreshTokens.add(refresh);
        given.push({ label: 'a made-up refresh token', value: refresh });
        out['refresh_token'] = refresh;
      }
      return out;
    };
    if (form.get('grant_type') === 'authorization_code') {
      const code = codes.get(form.get('code') ?? '');
      if (
        !code ||
        code.used ||
        code.redirectUri !== form.get('redirect_uri') ||
        challengeOf(form.get('code_verifier') ?? '') !== code.challenge
      ) {
        if (code) code.used = true;
        send(res, 400, { error: 'invalid_grant', error_description: 'Bad Request' });
        return;
      }
      code.used = true;
      send(res, 200, issue(true));
      return;
    }
    if (form.get('grant_type') === 'refresh_token') {
      if (!refreshTokens.has(form.get('refresh_token') ?? '')) {
        send(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        return;
      }
      send(res, 200, issue(false));
      return;
    }
    send(res, 400, { error: 'unsupported_grant_type' });
  }

  function auth(url: URL, res: ServerResponse): void {
    const q = url.searchParams;
    const redirectUri = q.get('redirect_uri') ?? '';
    const right =
      q.get('client_id') === STANDIN_CLIENT_ID &&
      /^http:\/\/127\.0\.0\.1:\d+$/u.test(redirectUri) &&
      q.get('response_type') === 'code' &&
      (q.get('scope') ?? '').split(' ').includes(STANDIN_SCOPE) &&
      q.get('code_challenge_method') === 'S256' &&
      (q.get('code_challenge') ?? '').length === 43 &&
      (q.get('state') ?? '') !== '';
    if (!right) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Error 400: invalid_request');
      return;
    }
    const back = new URL(redirectUri);
    back.searchParams.set('state', q.get('state') ?? '');
    if (standIn.consent === 'deny') back.searchParams.set('error', 'access_denied');
    else {
      const code = made('code');
      codes.set(code, { challenge: q.get('code_challenge') ?? '', redirectUri, used: false });
      back.searchParams.set('code', code);
      back.searchParams.set('scope', standIn.grantedScope);
    }
    res.writeHead(302, { location: back.toString() });
    res.end();
  }

  async function youtube(req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
    const bearer = /^Bearer (.+)$/u.exec(req.headers.authorization ?? '')?.[1] ?? '';
    if (!accessTokens.has(bearer)) {
      send(res, 401, {
        error: {
          code: 401,
          message: 'Request had invalid authentication credentials.',
          errors: [{ message: 'Invalid Credentials', domain: 'global', reason: 'authError' }],
          status: 'UNAUTHENTICATED',
        },
      });
      return;
    }
    if (standIn.mode === 'quota') {
      send(res, 403, {
        error: {
          code: 403,
          message: 'The request cannot be completed because you have exceeded your quota.',
          errors: [
            {
              message: 'The request cannot be completed because you have exceeded your quota.',
              domain: 'youtube.quota',
              reason: 'quotaExceeded',
            },
          ],
        },
      });
      return;
    }
    const path = url.pathname.replace(/^\/youtube\/v3\//u, '');
    const q = url.searchParams;
    if (path === 'channels' && req.method === 'GET') {
      send(res, 200, {
        kind: 'youtube#channelListResponse',
        items: standIn.noChannel
          ? []
          : [{ id: 'UCplaceholder0000000000', snippet: { title: STANDIN_CHANNEL } }],
      });
      return;
    }
    if (standIn.mode === 'not-enabled') {
      send(
        res,
        403,
        googleError(403, 'liveStreamingNotEnabled', 'The user is not enabled for live streaming.'),
      );
      return;
    }
    if (path === 'liveBroadcasts' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req)) as {
        snippet?: { title?: string; description?: string; scheduledStartTime?: string };
        status?: { privacyStatus?: string; selfDeclaredMadeForKids?: boolean };
        contentDetails?: { enableAutoStart?: boolean; enableAutoStop?: boolean };
      };
      const title = body.snippet?.title ?? '';
      const starts = Date.parse(body.snippet?.scheduledStartTime ?? '');
      if (title.length < 1 || title.length > 100) {
        send(res, 400, googleError(400, 'invalidTitle', 'Invalid title.'));
        return;
      }
      if ((body.snippet?.description ?? '').length > 5000) {
        send(res, 400, googleError(400, 'invalidDescription', 'Invalid description.'));
        return;
      }
      if (!Number.isFinite(starts) || starts <= now()) {
        send(res, 400, googleError(400, 'invalidScheduledStartTime', 'Invalid scheduled start time.'));
        return;
      }
      if (!['public', 'unlisted', 'private'].includes(body.status?.privacyStatus ?? '')) {
        send(res, 400, googleError(400, 'invalidPrivacyStatus', 'Invalid privacy status.'));
        return;
      }
      const b: FakeBroadcast = {
        id: `placeholderB${String(next++)}`,
        title,
        description: body.snippet?.description ?? '',
        scheduledStartTime: new Date(starts).toISOString(),
        privacyStatus: body.status?.privacyStatus ?? 'private',
        selfDeclaredMadeForKids: body.status?.selfDeclaredMadeForKids ?? null,
        enableAutoStart: body.contentDetails?.enableAutoStart ?? null,
        enableAutoStop: body.contentDetails?.enableAutoStop ?? null,
        lifeCycleStatus: 'created',
        boundStreamId: null,
      };
      standIn.broadcasts.set(b.id, b);
      send(res, 200, broadcastResource(b));
      return;
    }
    if (path === 'liveStreams' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req)) as {
        snippet?: { title?: string };
        cdn?: { ingestionType?: string; resolution?: string; frameRate?: string };
        contentDetails?: { isReusable?: boolean };
      };
      const title = body.snippet?.title ?? '';
      if (title.length < 1 || title.length > 128) {
        send(res, 400, googleError(400, 'invalidTitle', 'Invalid title.'));
        return;
      }
      if (
        body.cdn?.ingestionType !== 'rtmp' ||
        (body.cdn.resolution === 'variable') !== (body.cdn.frameRate === 'variable')
      ) {
        send(res, 400, googleError(400, 'invalidFormat', 'Invalid format.'));
        return;
      }
      const s: FakeStream = {
        id: `placeholderS${String(next++)}`,
        title,
        key: made('youtube-key'),
        isReusable: body.contentDetails?.isReusable ?? true,
      };
      given.push({ label: 'a made-up YouTube stream key', value: s.key });
      standIn.streams.set(s.id, s);
      send(res, 200, streamResource(s));
      return;
    }
    if (path === 'liveBroadcasts/bind' && req.method === 'POST') {
      const b = standIn.broadcasts.get(q.get('id') ?? '');
      const s = standIn.streams.get(q.get('streamId') ?? '');
      if (!b) {
        send(res, 404, googleError(404, 'liveBroadcastNotFound', 'Broadcast not found'));
        return;
      }
      if (!s) {
        send(res, 404, googleError(404, 'liveStreamNotFound', 'Stream not found'));
        return;
      }
      if (b.lifeCycleStatus !== 'created' && b.lifeCycleStatus !== 'ready') {
        send(res, 403, googleError(403, 'liveBroadcastBindingNotAllowed', 'Binding not allowed.'));
        return;
      }
      b.boundStreamId = s.id;
      b.lifeCycleStatus = 'ready';
      send(res, 200, broadcastResource(b));
      return;
    }
    if (path === 'liveBroadcasts' && req.method === 'GET') {
      const ids = q.get('id')?.split(',');
      const status = q.get('broadcastStatus');
      const items = [...standIn.broadcasts.values()].filter((b) =>
        ids
          ? ids.includes(b.id)
          : status === 'upcoming'
            ? b.lifeCycleStatus === 'created' || b.lifeCycleStatus === 'ready'
            : status === 'active'
              ? b.lifeCycleStatus === 'live'
              : true,
      );
      send(res, 200, { kind: 'youtube#liveBroadcastListResponse', items: items.map(broadcastResource) });
      return;
    }
    if (path === 'liveStreams' && req.method === 'GET') {
      const ids = q.get('id')?.split(',') ?? [];
      const items = [...standIn.streams.values()].filter((s) => ids.includes(s.id));
      send(res, 200, { kind: 'youtube#liveStreamListResponse', items: items.map(streamResource) });
      return;
    }
    if (path === 'liveBroadcasts/transition' && req.method === 'POST') {
      const b = standIn.broadcasts.get(q.get('id') ?? '');
      if (!b) {
        send(res, 404, googleError(404, 'liveBroadcastNotFound', 'Broadcast not found'));
        return;
      }
      if (q.get('broadcastStatus') !== 'complete') {
        send(res, 400, googleError(400, 'invalidTransition', 'Only complete is offered here.'));
        return;
      }
      if (b.lifeCycleStatus === 'complete') {
        send(res, 403, googleError(403, 'redundantTransition', 'Redundant transition'));
        return;
      }
      if (
        b.lifeCycleStatus !== 'live' &&
        b.lifeCycleStatus !== 'liveStarting' &&
        b.lifeCycleStatus !== 'testing'
      ) {
        send(res, 403, googleError(403, 'invalidTransition', 'Invalid transition'));
        return;
      }
      b.lifeCycleStatus = 'complete';
      send(res, 200, broadcastResource(b));
      return;
    }
    send(res, 404, googleError(404, 'notFound', 'Not found'));
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    standIn.calls.push(`${req.method ?? 'GET'} ${url.pathname}`);
    if (standIn.mode === 'offline') {
      req.socket.destroy();
      return;
    }
    if (standIn.mode === 'server-error' && url.pathname !== '/o/oauth2/v2/auth') {
      send(res, 503, { error: { code: 503, message: 'Backend Error' } });
      return;
    }
    const answer = async () => {
      if (url.pathname === '/o/oauth2/v2/auth' && req.method === 'GET') auth(url, res);
      else if (url.pathname === '/token' && req.method === 'POST') await token(req, res);
      else if (url.pathname.startsWith('/youtube/v3/')) await youtube(req, url, res);
      else send(res, 404, { error: 'not_found' });
    };
    answer().catch(() => {
      if (!res.headersSent) send(res, 500, { error: { code: 500, message: 'Backend Error' } });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;

  const standIn: GoogleStandIn = {
    base: `http://127.0.0.1:${String(port)}`,
    calls: [],
    broadcasts: new Map(),
    streams: new Map(),
    mode: 'answer',
    consent: 'allow',
    grantedScope: STANDIN_SCOPE,
    noChannel: false,
    ingestion: options.ingestion,
    expireAccessTokens: () => {
      accessTokens.clear();
    },
    refuseRefreshTokens: () => {
      refreshTokens.clear();
      accessTokens.clear();
    },
    streamArrived: (key) => {
      const stream = [...standIn.streams.values()].find((s) => s.key === key);
      if (!stream) return;
      for (const b of standIn.broadcasts.values())
        if (b.boundStreamId === stream.id && b.enableAutoStart === true && b.lifeCycleStatus === 'ready')
          b.lifeCycleStatus = 'live';
    },
    addBroadcast: (fields) => {
      const b: FakeBroadcast = {
        id: `placeholderB${String(next++)}`,
        description: '',
        scheduledStartTime: new Date(now() + 2 * 60 * 60 * 1000).toISOString(),
        privacyStatus: 'unlisted',
        selfDeclaredMadeForKids: false,
        enableAutoStart: true,
        enableAutoStop: false,
        lifeCycleStatus: 'created',
        boundStreamId: null,
        ...fields,
      };
      standIn.broadcasts.set(b.id, b);
      return b;
    },
    browse: async (signInUrl) => {
      const page = await fetch(signInUrl, { redirect: 'manual' });
      const location = page.headers.get('location');
      if (page.status !== 302 || !location)
        return { status: page.status, page: await page.text(), reachedDrashti: false };
      const back = await fetch(location, { redirect: 'manual' });
      return { status: back.status, page: await back.text(), reachedDrashti: true };
    },
    secrets: () => [...given],
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
  return standIn;
}
