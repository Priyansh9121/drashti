import { afterEach, describe, expect, it } from 'vitest';
import {
  googleStandIn,
  STANDIN_CHANNEL,
  STANDIN_CLIENT_ID,
  STANDIN_CLIENT_SECRET,
  type GoogleStandIn,
} from '../../../tests/youtube-standin';
import { challengeOf, exchangeCode, listenForBrowser, makePkce, signInAddress } from './google-sign-in';
import { nodeGoogleTransport, standInEndpoints } from './google-transport';
import { AUTO_START, AUTO_STOP, broadcastOf, ingestOf, stateOf, YouTubeApi } from './youtube-api';

/*
 * The YouTube Data API calls Drashti makes (x31), against the tests' stand-in for Google on 127.0.0.1: what a
 * schedule sends, a stream's key and address taken only when they are YouTube's, and each of Google's refusals as
 * itself.
 */

const LISTENER = 'rtmp://127.0.0.1:1935/live2';
let standIn: GoogleStandIn | null = null;
afterEach(async () => {
  await standIn?.close();
  standIn = null;
});

const call = { transport: nodeGoogleTransport, onlyThisComputer: true };

/** The stand-in, an access token from it (signed in as a person would be), and the API on it. */
async function signedIn(): Promise<{ s: GoogleStandIn; api: YouTubeApi; token: string }> {
  const s = await googleStandIn({ ingestion: LISTENER });
  standIn = s;
  const endpoints = standInEndpoints(s.base);
  const { verifier, challenge } = makePkce();
  const l = await listenForBrowser('st');
  await s.browse(
    signInAddress(endpoints, {
      clientId: STANDIN_CLIENT_ID,
      redirectUri: l.redirectUri,
      challenge,
      state: 'st',
    }),
  );
  const answer = await l.answer;
  if (!answer.ok) throw new Error('not signed in');
  const tokens = await exchangeCode(
    endpoints,
    call,
    {
      code: answer.code,
      clientId: STANDIN_CLIENT_ID,
      clientSecret: STANDIN_CLIENT_SECRET,
      redirectUri: l.redirectUri,
      verifier,
    },
    Date.now(),
  );
  if (!tokens.ok) throw new Error('no token');
  expect(challengeOf(verifier)).toBe(challenge);
  return { s, api: new YouTubeApi(endpoints, call), token: tokens.accessToken };
}

const words = (startsAt: number) => ({
  title: 'Placeholder sabha',
  description: 'Placeholder words.',
  startsAt,
  privacy: 'unlisted' as const,
  madeForKids: false,
});

describe('a schedule', () => {
  it('makes a broadcast that starts by itself and never ends by itself, with a one-use stream of any size bound to it', async () => {
    const { s, api, token } = await signedIn();
    expect(AUTO_START).toBe(true);
    expect(AUTO_STOP).toBe(false);
    expect(await api.channel(token)).toEqual({ ok: true, value: STANDIN_CHANNEL });
    const startsAt = Date.UTC(2030, 0, 5, 12, 30);
    const made = await api.insertBroadcast(token, words(startsAt));
    if (!made.ok) throw new Error(made.problem);
    const kept = s.broadcasts.get(made.value.id);
    expect(kept).toMatchObject({
      title: 'Placeholder sabha',
      description: 'Placeholder words.',
      scheduledStartTime: '2030-01-05T12:30:00.000Z',
      privacyStatus: 'unlisted',
      selfDeclaredMadeForKids: false,
      enableAutoStart: true,
      enableAutoStop: false,
    });
    const stream = await api.insertStream(token, 'Placeholder sabha');
    if (!stream.ok) throw new Error(stream.problem);
    expect(s.streams.get(stream.value.id)).toMatchObject({
      title: 'Drashti: Placeholder sabha',
      isReusable: false,
    });
    const bound = await api.bind(token, made.value.id, stream.value.id);
    if (!bound.ok) throw new Error(bound.problem);
    expect(broadcastOf(bound.value)).toEqual({
      id: made.value.id,
      title: 'Placeholder sabha',
      startsAt,
      privacy: 'unlisted',
      state: 'upcoming',
      boundStreamId: stream.value.id,
    });
    const ingest = ingestOf(stream.value, true);
    expect(ingest).toEqual({ key: s.streams.get(stream.value.id)?.key, address: LISTENER });
    // Listed as coming, found by its id, and its stream by its own.
    const coming = await api.upcoming(token);
    expect(coming.ok && coming.value.map((b) => b.id)).toEqual([made.value.id]);
    const one = await api.broadcast(token, made.value.id);
    expect(one.ok && one.value?.id).toBe(made.value.id);
    const its = await api.stream(token, stream.value.id);
    expect(its.ok && its.value?.id).toBe(stream.value.id);
    expect(await api.broadcast(token, 'no-such-one')).toEqual({ ok: true, value: null });
  });

  it('ends a broadcast that went live; one already over is already over; one that never started cannot be', async () => {
    const { s, api, token } = await signedIn();
    const made = await api.insertBroadcast(token, words(Date.now() + 3_600_000));
    const stream = await api.insertStream(token, 'x');
    if (!made.ok || !stream.ok) throw new Error('not made');
    await api.bind(token, made.value.id, stream.value.id);
    expect(await api.complete(token, made.value.id)).toEqual({
      ok: false,
      problem: 'transition',
      detail: null,
    });
    s.streamArrived(s.streams.get(stream.value.id)?.key ?? '');
    expect(s.broadcasts.get(made.value.id)?.lifeCycleStatus).toBe('live');
    expect(await api.complete(token, made.value.id)).toEqual({ ok: true, value: 'ended' });
    expect(await api.complete(token, made.value.id)).toEqual({ ok: true, value: 'already' });
  });
});

describe('Google’s refusals, each as itself', () => {
  it('a refused token, the day’s quota, live streaming not on, a time in the past, no answer, a server error', async () => {
    const { s, api, token } = await signedIn();
    expect(await api.upcoming('not-a-token')).toEqual({ ok: false, problem: 'unauthorized', detail: null });
    expect(await api.insertBroadcast(token, words(Date.now() - 60_000))).toEqual({
      ok: false,
      problem: 'bad-time',
      detail: null,
    });
    s.mode = 'quota';
    expect(await api.upcoming(token)).toEqual({ ok: false, problem: 'quota', detail: null });
    s.mode = 'not-enabled';
    expect(await api.insertStream(token, 'x')).toEqual({ ok: false, problem: 'not-enabled', detail: null });
    s.mode = 'server-error';
    expect(await api.upcoming(token)).toEqual({ ok: false, problem: 'unavailable', detail: null });
    s.mode = 'offline';
    expect(await api.upcoming(token)).toEqual({ ok: false, problem: 'offline', detail: null });
  });

  it('a channel-less account', async () => {
    const { s, api, token } = await signedIn();
    s.noChannel = true;
    expect(await api.channel(token)).toEqual({ ok: false, problem: 'no-channel', detail: null });
  });
});

describe('a stream’s key and address', () => {
  const stream = (streamName: string, rtmps?: string, rtmp?: string) => ({
    id: 's1',
    cdn: { ingestionInfo: { streamName, rtmpsIngestionAddress: rtmps, ingestionAddress: rtmp } },
  });
  const KEY = 'abcd-efgh-ijkl-mnop-qrst';

  it('are taken only when they are YouTube’s RTMPS address and a key’s shape', () => {
    expect(ingestOf(stream(KEY, 'rtmps://a.rtmps.youtube.com/live2'), false)).toEqual({
      key: KEY,
      address: 'rtmps://a.rtmps.youtube.com/live2',
    });
    for (const odd of [
      stream(KEY, 'rtmp://a.rtmp.youtube.com/live2'),
      stream(KEY, 'rtmps://a.rtmps.youtube.com.example.org/live2'),
      stream(KEY, 'rtmps://example.org/live2'),
      stream(KEY, 'rtmps://a.rtmps.youtube.com/live2?x=1'),
      stream(KEY, undefined, 'rtmp://a.rtmp.youtube.com/live2'),
      stream(KEY, 'rtmp://127.0.0.1:1935/live2'),
      stream('has spaces in it', 'rtmps://a.rtmps.youtube.com/live2'),
      stream('short', 'rtmps://a.rtmps.youtube.com/live2'),
    ])
      expect(ingestOf(odd, false)).toBeNull();
  });

  it('under the tests’ guard, only the tests’ listener on 127.0.0.1', () => {
    expect(ingestOf(stream(KEY, undefined, 'rtmp://127.0.0.1:1935/live2'), true)).toEqual({
      key: KEY,
      address: 'rtmp://127.0.0.1:1935/live2',
    });
    expect(ingestOf(stream(KEY, 'rtmps://a.rtmps.youtube.com/live2'), true)).toBeNull();
  });

  it('YouTube’s life cycle in Drashti’s words', () => {
    expect(
      [
        'created',
        'ready',
        'testStarting',
        'testing',
        'liveStarting',
        'live',
        'complete',
        'revoked',
        undefined,
      ].map(stateOf),
    ).toEqual([
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
      'starting',
      'live',
      'ended',
      'removed',
      'upcoming',
    ]);
  });
});
