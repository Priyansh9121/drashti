import { z } from 'zod';
import type { YouTubeBroadcast, YouTubeBroadcastState, YouTubePrivacy } from '../../shared/youtube';
import { cutText } from '../../shared/text';
import { callGoogle, type CallOptions, type GoogleEndpoints } from './google-transport';

/*
 * The YouTube Data API v3 calls Drashti makes (x31), each with an access token the caller gives: what a schedule
 * needs (liveBroadcasts.insert, liveStreams.insert, liveBroadcasts.bind), the channel's coming broadcasts
 * (liveBroadcasts.list) and one broadcast or stream by its id, the channel's name (channels.list), and ending a
 * broadcast (liveBroadcasts.transition to complete). Each costs 1 unit of the project's free 10,000 a day (Google's
 * quota table, read 19 Nov 2026). Nothing here keeps or logs a token or a key: a stream's key goes back to the caller
 * alone, which saves it in the stream key store.
 *
 * A broadcast is made to start by itself when its stream arrives (contentDetails.enableAutoStart), so going live is
 * Drashti's own Go live and never a call here; and never to end by itself (enableAutoStop off), so a dropped
 * connection never ends it: Drashti's End the stream… ends it (complete).
 */

/** Why a call came to nothing, for the words the operator reads (youtube-service.ts). */
export type ApiProblem =
  | 'offline'
  | 'guard'
  /** The access token was refused (the caller gets a new one once, then asks again once). */
  | 'unauthorized'
  | 'quota'
  | 'not-enabled'
  | 'too-fast'
  | 'too-many'
  | 'bad-time'
  | 'not-found'
  | 'no-channel'
  /** The broadcast cannot go to that state now (ending one that never went live). */
  | 'transition'
  /** An answer Drashti does not take: a stream key or an address that is not YouTube's. */
  | 'odd-answer'
  | 'unavailable'
  | 'refused';

export type ApiAnswer<T> = { ok: true; value: T } | { ok: false; problem: ApiProblem; detail: string | null };

/** A broadcast is made to start by itself when the stream arrives: no call to Google while going live. */
export const AUTO_START = true;
/** And never to end by itself (a dropped connection would end it about a minute later): End the stream… ends it. */
export const AUTO_STOP = false;

const broadcastSchema = z.object({
  id: z.string().min(1).max(200),
  snippet: z.object({
    title: z.string().max(1000),
    scheduledStartTime: z.string().max(100).optional(),
  }),
  status: z
    .object({
      lifeCycleStatus: z.string().max(100).optional(),
      privacyStatus: z.string().max(100).optional(),
    })
    .optional(),
  contentDetails: z.object({ boundStreamId: z.string().max(200).optional() }).optional(),
});
type RawBroadcast = z.infer<typeof broadcastSchema>;

const streamSchema = z.object({
  id: z.string().min(1).max(200),
  cdn: z
    .object({
      ingestionInfo: z
        .object({
          streamName: z.string().max(1000).optional(),
          ingestionAddress: z.string().max(2000).optional(),
          rtmpsIngestionAddress: z.string().max(2000).optional(),
        })
        .optional(),
    })
    .optional(),
});
type RawStream = z.infer<typeof streamSchema>;

const listOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item).max(500).optional() });

const channelSchema = z.object({
  id: z.string().max(200),
  snippet: z.object({ title: z.string().max(1000) }),
});

const googleErrorSchema = z.object({
  error: z.object({
    message: z.string().max(4000).optional(),
    errors: z.array(z.object({ reason: z.string().max(200).optional() })).optional(),
  }),
});

/** A broadcast as a window may see it. */
export function broadcastOf(raw: RawBroadcast): YouTubeBroadcast & { boundStreamId: string | null } {
  const startsAt = Date.parse(raw.snippet.scheduledStartTime ?? '');
  return {
    id: raw.id,
    title: raw.snippet.title,
    startsAt: Number.isFinite(startsAt) ? startsAt : 0,
    privacy: privacyOf(raw.status?.privacyStatus),
    state: stateOf(raw.status?.lifeCycleStatus),
    boundStreamId: raw.contentDetails?.boundStreamId ?? null,
  };
}

const privacyOf = (value: string | undefined): YouTubePrivacy =>
  value === 'public' || value === 'unlisted' || value === 'private' ? value : 'private';

/** YouTube's lifeCycleStatus in Drashti's words. */
export function stateOf(value: string | undefined): YouTubeBroadcastState {
  switch (value) {
    case 'liveStarting':
      return 'starting';
    case 'live':
      return 'live';
    case 'complete':
      return 'ended';
    case 'revoked':
      return 'removed';
    default:
      // created, ready, testStarting, testing: not yet seen by its audience.
      return 'upcoming';
  }
}

/** A stream key as YouTube gives it (the stream key store's own rule: letters, digits, dashes, underscores). */
const keyShape = /^[A-Za-z0-9_-]{8,200}$/u;

/**
 * Where a broadcast's stream goes and its key, when they are what Drashti streams to: YouTube's RTMPS address
 * (rtmps://….youtube.com/…), or, under the tests' guard, the tests' listener on 127.0.0.1.
 */
export function ingestOf(raw: RawStream, onlyThisComputer: boolean): { key: string; address: string } | null {
  const info = raw.cdn?.ingestionInfo;
  const key = info?.streamName ?? '';
  const address =
    info?.rtmpsIngestionAddress ?? (onlyThisComputer ? info?.ingestionAddress : undefined) ?? '';
  if (!keyShape.test(key)) return null;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const plain = url.search === '' && url.hash === '' && url.username === '' && url.password === '';
  const youtube =
    url.protocol === 'rtmps:' && (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com'));
  const here = onlyThisComputer && /^rtmps?:$/u.test(url.protocol) && url.hostname === '127.0.0.1';
  if (!plain || !(onlyThisComputer ? here : youtube)) return null;
  return { key, address: address.replace(/\/+$/u, '') };
}

function problemOf(status: number, json: unknown): { problem: ApiProblem; detail: string | null } {
  const parsed = googleErrorSchema.safeParse(json);
  const reason = parsed.success ? (parsed.data.error.errors?.[0]?.reason ?? null) : null;
  const message = parsed.success ? (parsed.data.error.message ?? null) : null;
  if (status === 401) return { problem: 'unauthorized', detail: null };
  switch (reason) {
    case 'quotaExceeded':
    case 'dailyLimitExceeded':
      return { problem: 'quota', detail: null };
    case 'liveStreamingNotEnabled':
    case 'livePermissionBlocked':
      return { problem: 'not-enabled', detail: null };
    case 'userRequestsExceedRateLimit':
    case 'rateLimitExceeded':
    case 'userRateLimitExceeded':
      return { problem: 'too-fast', detail: null };
    case 'userBroadcastsExceedLimit':
      return { problem: 'too-many', detail: null };
    case 'invalidScheduledStartTime':
    case 'scheduledStartTimeRequired':
      return { problem: 'bad-time', detail: null };
    case 'liveBroadcastNotFound':
    case 'liveStreamNotFound':
      return { problem: 'not-found', detail: null };
    case 'invalidTransition':
    case 'errorStreamInactive':
      return { problem: 'transition', detail: null };
    default:
      break;
  }
  if (status === 404) return { problem: 'not-found', detail: null };
  if (status >= 500) return { problem: 'unavailable', detail: null };
  return { problem: 'refused', detail: message === null ? null : cutText(message, 300, '…') };
}

export interface ScheduleWords {
  title: string;
  description: string;
  startsAt: number;
  privacy: YouTubePrivacy;
  madeForKids: boolean;
}

export class YouTubeApi {
  constructor(
    private readonly endpoints: GoogleEndpoints,
    private readonly call: CallOptions,
  ) {}

  private async request<T extends z.ZodType>(
    token: string,
    method: 'GET' | 'POST',
    path: string,
    query: Record<string, string>,
    body: unknown,
    schema: T,
  ): Promise<ApiAnswer<z.output<T>>> {
    const url = new URL(`${this.endpoints.api}/${path}`);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    const reply = await callGoogle(
      {
        method,
        url: url.toString(),
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? (method === 'POST' ? '' : null) : JSON.stringify(body),
      },
      this.call,
    );
    if (!reply.reached) return { ok: false, problem: reply.guard ? 'guard' : 'offline', detail: null };
    if (reply.status < 200 || reply.status > 299)
      return { ok: false, ...problemOf(reply.status, reply.json) };
    const parsed = schema.safeParse(reply.json);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, problem: 'odd-answer', detail: null };
  }

  /** The signed-in channel's name. */
  async channel(token: string): Promise<ApiAnswer<string>> {
    const got = await this.request(
      token,
      'GET',
      'channels',
      { part: 'snippet', mine: 'true' },
      undefined,
      listOf(channelSchema),
    );
    if (!got.ok) return got;
    const first = got.value.items?.[0];
    return first
      ? { ok: true, value: first.snippet.title }
      : { ok: false, problem: 'no-channel', detail: null };
  }

  /** A new broadcast, starting by itself when its stream arrives and never ending by itself. */
  insertBroadcast(token: string, words: ScheduleWords): Promise<ApiAnswer<RawBroadcast>> {
    return this.request(
      token,
      'POST',
      'liveBroadcasts',
      { part: 'id,snippet,status,contentDetails' },
      {
        snippet: {
          title: words.title,
          description: words.description,
          scheduledStartTime: new Date(words.startsAt).toISOString(),
        },
        status: { privacyStatus: words.privacy, selfDeclaredMadeForKids: words.madeForKids },
        contentDetails: { enableAutoStart: AUTO_START, enableAutoStop: AUTO_STOP },
      },
      broadcastSchema,
    );
  }

  /** A new one-use stream (its own key) of any size and frame rate, for one broadcast. */
  insertStream(token: string, title: string): Promise<ApiAnswer<RawStream>> {
    return this.request(
      token,
      'POST',
      'liveStreams',
      { part: 'id,snippet,cdn,contentDetails,status' },
      {
        snippet: { title: cutText(`Drashti: ${title}`, 128) },
        cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' },
        contentDetails: { isReusable: false },
      },
      streamSchema,
    );
  }

  bind(token: string, broadcastId: string, streamId: string): Promise<ApiAnswer<RawBroadcast>> {
    return this.request(
      token,
      'POST',
      'liveBroadcasts/bind',
      { id: broadcastId, streamId, part: 'id,snippet,status,contentDetails' },
      undefined,
      broadcastSchema,
    );
  }

  /** The channel's scheduled broadcasts that have not started, soonest first (at most 25). */
  async upcoming(token: string): Promise<ApiAnswer<RawBroadcast[]>> {
    const got = await this.request(
      token,
      'GET',
      'liveBroadcasts',
      { part: 'id,snippet,status,contentDetails', broadcastStatus: 'upcoming', maxResults: '25' },
      undefined,
      listOf(broadcastSchema),
    );
    return got.ok ? { ok: true, value: got.value.items ?? [] } : got;
  }

  /** One broadcast by its id, or null when the channel has no such one. */
  async broadcast(token: string, id: string): Promise<ApiAnswer<RawBroadcast | null>> {
    const got = await this.request(
      token,
      'GET',
      'liveBroadcasts',
      { part: 'id,snippet,status,contentDetails', id },
      undefined,
      listOf(broadcastSchema),
    );
    return got.ok ? { ok: true, value: got.value.items?.find((b) => b.id === id) ?? null } : got;
  }

  /** One stream by its id (a one-use stream is listed only this way), or null. */
  async stream(token: string, id: string): Promise<ApiAnswer<RawStream | null>> {
    const got = await this.request(
      token,
      'GET',
      'liveStreams',
      { part: 'id,cdn', id },
      undefined,
      listOf(streamSchema),
    );
    return got.ok ? { ok: true, value: got.value.items?.find((s) => s.id === id) ?? null } : got;
  }

  /** End a broadcast (complete); `already` when YouTube says it is already over or ending. */
  async complete(token: string, id: string): Promise<ApiAnswer<'ended' | 'already'>> {
    const url = new URL(`${this.endpoints.api}/liveBroadcasts/transition`);
    url.searchParams.set('broadcastStatus', 'complete');
    url.searchParams.set('id', id);
    url.searchParams.set('part', 'id,status');
    const reply = await callGoogle(
      {
        method: 'POST',
        url: url.toString(),
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        body: '',
      },
      this.call,
    );
    if (!reply.reached) return { ok: false, problem: reply.guard ? 'guard' : 'offline', detail: null };
    if (reply.status >= 200 && reply.status <= 299) return { ok: true, value: 'ended' };
    const parsed = googleErrorSchema.safeParse(reply.json);
    if (parsed.success && parsed.data.error.errors?.[0]?.reason === 'redundantTransition')
      return { ok: true, value: 'already' };
    return { ok: false, ...problemOf(reply.status, reply.json) };
  }
}
