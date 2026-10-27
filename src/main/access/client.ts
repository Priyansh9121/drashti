import { createHmac, createPublicKey, randomBytes, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import {
  ACCESS_LIST_PUBLIC_KEY,
  ACCESS_LIST_URL,
  ACCESS_LIST_URL_SHAPE,
  accessConfigReal,
  accessKeyShaped,
} from '../../shared/access-config';
import {
  ACCESS_CHECK_STATUSES,
  ACCESS_ERRORS,
  ACCESS_MAC_PREFIX,
  ACCESS_REQUEST_STATUSES,
  ACCESS_VERSION,
  canonicalJson,
  type AccessActivity,
  type AccessCheckStatus,
  type AccessComputer,
  type AccessErrorCode,
  type AccessGrant,
  type AccessOp,
  type AccessPerson,
  type AccessRequestStatus,
} from '../../shared/access-protocol';
import type { Switches } from '../switches';

/*
 * Drashti's side of the access list (Session 54, E1): every call the list in the owner's Google account takes
 * (access-list/PROTOCOL.md), as typed functions, for the lock (E2), the live checks (E3) and the Access List
 * (E4). Only the main process calls the list.
 *
 * - HTTPS to the list's own address (script.google.com) only, following Apps Script's redirect only to
 *   Google's hosts (script.google.com, script.googleusercontent.com). Tests only: the stand-in list on
 *   http://127.0.0.1 (tests/access-standin.ts), from DRASHTI_TEST_ACCESS_URL and DRASHTI_TEST_ACCESS_KEY,
 *   which a packaged Drashti never reads (accessTarget, and src/main/switches.ts).
 * - A time limit on every call (its redirect and answer included); a new nonce each call; the signed calls
 *   (check, and the owner's) carry their mac.
 * - An answer is believed only when its signature is the list's (the public key built in) and it echoes the
 *   call's op, nonce and computer id: a fake server, an old answer or another computer's answer is no answer.
 */

/** Every call ends within this, its redirect and answer included. */
export const ACCESS_CALL_TIMEOUT_MS = 20_000;
/** An answer is read only up to this size (the owner's list of 200 people is about 100 KB). */
const MAX_ANSWER_CHARS = 4 * 1024 * 1024;
/** Apps Script answers a POST with one redirect; a few more are allowed, never to anywhere but Google. */
const MAX_REDIRECTS = 3;
const GOOGLE_HOSTS: ReadonlySet<string> = new Set(['script.google.com', 'script.googleusercontent.com']);

/** One HTTP answer, a redirect handed back (the client checks where it goes before following it). */
export interface AccessReply {
  status: number;
  /** A redirect's Location, or null. */
  location: string | null;
  /** The body, refused (it throws) past `maxChars`. */
  text(maxChars: number): Promise<string>;
  /** Close the connection without reading on. */
  cancel(): void;
}

export interface AccessRequest {
  method: 'GET' | 'POST';
  url: string;
  /** JSON text for a POST; null for a GET. */
  body: string | null;
  signal: AbortSignal;
}

/** One request that never follows a redirect. Drashti uses Electron's (electron-transport.ts). */
export type AccessTransport = (request: AccessRequest) => Promise<AccessReply>;

/** Node's own fetch, redirects handed back: the unit tests' (and any plain Node helper's). */
export const nodeTransport: AccessTransport = async ({ method, url, body, signal }) => {
  const response = await fetch(url, {
    method,
    signal,
    redirect: 'manual',
    ...(body === null ? {} : { body, headers: { 'content-type': 'application/json' } }),
  });
  return {
    status: response.status,
    location: response.headers.get('location'),
    text: async (maxChars) => {
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > maxChars) throw new Error('The answer is too long.');
      const text = await response.text();
      if (text.length > maxChars) throw new Error('The answer is too long.');
      return text;
    },
    cancel: () => {
      void response.body?.cancel().catch(() => undefined);
    },
  };
};

/** Why nothing believable came back. */
export type AccessNoAnswer =
  /** The address is not one Drashti calls (not the list's own over HTTPS). Nothing was sent. */
  | 'address'
  /** No connection (no internet, the name not found, the connection refused or cut). */
  | 'network'
  /** No answer within the time limit. */
  | 'timeout'
  /** An HTTP status that is not an answer (Google busy, a page not found). */
  | 'http'
  /** Sent on to an address that is not Google's, or too many times. */
  | 'redirect'
  /** Not in the form { payload, sig }. */
  | 'unreadable'
  /** Not signed (a list not set up yet). */
  | 'unsigned'
  /** Not signed with the list's key: a fake server, or an answer changed on the way. */
  | 'signature'
  /** Signed, but for another call: another op, nonce or computer (an old or another computer's answer). */
  | 'not-ours'
  /** Signed and ours, but not in the form this Drashti knows. */
  | 'unexpected';

export type AccessResult<T> =
  | { ok: true; value: T; serverTime: number }
  /** The list answered, signed, and refused: what it said. */
  | { ok: false; kind: 'refused'; error: AccessErrorCode; message: string }
  /** Nothing believable came back: as if the list were not there. */
  | { ok: false; kind: 'no-answer'; reason: AccessNoAnswer; detail: string };

const noAnswer = (reason: AccessNoAnswer, detail: string): AccessResult<never> => ({
  ok: false,
  kind: 'no-answer',
  reason,
  detail,
});

// ---- the answers' forms ----

const HEX32 = /^[0-9a-f]{32}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const outerSchema = z.object({ payload: z.string(), sig: z.string() });
const headSchema = z.object({
  v: z.number(),
  op: z.string(),
  nonce: z.string(),
  computerId: z.string(),
  serverTime: z.number(),
  ok: z.boolean(),
});
const refusalSchema = z.object({ error: z.enum(ACCESS_ERRORS), message: z.string() });
const date = z.number().nullable();
const count = z.number().int().min(0);
const personSchema = z.object({
  gmail: z.string(),
  name: z.string(),
  status: z.string(),
  owner: z.boolean(),
  requestedAt: date,
  approvedAt: date,
  rejectedAt: date,
  revokedAt: date,
  lastSeen: date,
  version: z.string(),
  minutes: count,
  shows: count,
  streams: count,
  recordings: count,
  imports: count,
  note: z.string(),
  computers: z.array(
    z.object({
      name: z.string(),
      version: z.string(),
      platform: z.string(),
      lastSeen: date,
      usedAt: date,
      ended: z.boolean(),
      endedWhy: z.string(),
    }),
  ),
  token: z.object({ sentAt: z.number(), runsOut: z.number() }).nullable(),
  request: z.object({ computer: z.string(), at: date }).nullable(),
}) satisfies z.ZodType<AccessPerson>;

const requestedSchema = z.object({ status: z.literal('requested'), mailed: z.boolean() });
const statusSchema = z.object({ status: z.enum(ACCESS_REQUEST_STATUSES), tokenWaiting: z.boolean() });
const redeemSchema = z.object({
  grantId: z.string().regex(HEX32),
  secret: z.string().regex(HEX64),
  owner: z.boolean(),
});
const checkSchema = z.object({
  status: z.enum(ACCESS_CHECK_STATUSES),
  owner: z.boolean(),
  recorded: z.boolean(),
});
const listSchema = z.object({ people: z.array(personSchema) });
const approvedSchema = z.object({ status: z.literal('approved'), runsOut: z.number() });
const rejectedSchema = z.object({ status: z.literal('rejected'), mailed: z.boolean() });
const revokedSchema = z.object({ status: z.literal('revoked') });
const notedSchema = z.object({});

export interface AccessClientOptions {
  /** The list's address: access-config.ts's, or the stand-in's (accessTarget). */
  url: string;
  /** The list's public key: SPKI, base64. */
  publicKey: string;
  /** This computer (identity.ts), sent with every call. */
  computer: AccessComputer;
  /** Electron's net in Drashti (electron-transport.ts); Node's fetch in the unit tests. */
  transport: AccessTransport;
  /** The stand-in list on http://127.0.0.1: from the test switches only, never in a packaged Drashti. */
  local?: boolean;
  timeoutMs?: number;
  /**
   * A signed call's `at`: Drashti's clock, never at or below the last one sent (store.ts's nextAt keeps it
   * across starts). By default this process's clock, kept rising.
   */
  at?: () => number;
}

/** The list's calls (access-list/PROTOCOL.md), each a typed function. */
export class AccessClient {
  private readonly key: KeyObject;
  private readonly timeoutMs: number;
  private readonly local: boolean;
  private lastAt = 0;

  constructor(private readonly o: AccessClientOptions) {
    this.local = o.local === true;
    this.timeoutMs = o.timeoutMs ?? ACCESS_CALL_TIMEOUT_MS;
    this.key = createPublicKey({ key: Buffer.from(o.publicKey, 'base64'), format: 'der', type: 'spki' });
    if (this.key.asymmetricKeyType !== 'rsa')
      throw new Error('The access list’s public key is not an RSA key.');
  }

  /** The person asks for access: their row requested, and the approver emailed (mailed: false when it could not be). */
  request(gmail: string, name?: string): Promise<AccessResult<z.infer<typeof requestedSchema>>> {
    return this.call('request', { gmail, ...(name === undefined ? {} : { name }) }, requestedSchema);
  }

  /** What became of this computer's request. */
  status(gmail: string): Promise<AccessResult<{ status: AccessRequestStatus; tokenWaiting: boolean }>> {
    return this.call('status', { gmail }, statusSchema);
  }

  /** The token from the email, used once: this computer's grant, to keep (store.ts), and whether it is the owner's. */
  async redeem(gmail: string, token: string): Promise<AccessResult<{ grant: AccessGrant; owner: boolean }>> {
    const r = await this.call('redeem', { gmail, token }, redeemSchema);
    return r.ok
      ? {
          ...r,
          value: { grant: { gmail, grantId: r.value.grantId, secret: r.value.secret }, owner: r.value.owner },
        }
      : r;
  }

  /** Every 15 s: still let in? With this computer's totals since its token was used. */
  check(
    grant: AccessGrant,
    activity: AccessActivity,
  ): Promise<AccessResult<{ status: AccessCheckStatus; owner: boolean; recorded: boolean }>> {
    return this.call('check', { activity }, checkSchema, grant);
  }

  /** The owner's: every Gmail on the list. */
  list(grant: AccessGrant): Promise<AccessResult<{ people: AccessPerson[] }>> {
    return this.call('list', {}, listSchema, grant);
  }

  /** The owner's: a Gmail added (a request, and the approver's email with its links). */
  add(
    grant: AccessGrant,
    target: string,
    o: { name?: string; note?: string } = {},
  ): Promise<AccessResult<z.infer<typeof requestedSchema>>> {
    return this.call('add', { target, ...o }, requestedSchema, grant);
  }

  /** The owner's: approved, and a token emailed to the Gmail. */
  approve(
    grant: AccessGrant,
    target: string,
  ): Promise<AccessResult<{ status: 'approved'; runsOut: number }>> {
    return this.call('approve', { target }, approvedSchema, grant);
  }

  /** The owner's: Give access again (a new token; after a revoke, with no computer in). */
  regrant(
    grant: AccessGrant,
    target: string,
  ): Promise<AccessResult<{ status: 'approved'; runsOut: number }>> {
    return this.call('regrant', { target }, approvedSchema, grant);
  }

  /** The owner's: a request rejected, the person told. */
  reject(grant: AccessGrant, target: string): Promise<AccessResult<{ status: 'rejected'; mailed: boolean }>> {
    return this.call('reject', { target }, rejectedSchema, grant);
  }

  /** The owner's: every computer of that Gmail stops at its next check. */
  revoke(grant: AccessGrant, target: string): Promise<AccessResult<{ status: 'revoked' }>> {
    return this.call('revoke', { target }, revokedSchema, grant);
  }

  /** The owner's: the row's note. */
  note(grant: AccessGrant, target: string, note: string): Promise<AccessResult<Record<string, never>>> {
    return this.call('note', { target, note }, notedSchema, grant);
  }

  private nextAt(): number {
    const now = Math.floor(this.o.at ? this.o.at() : Date.now());
    this.lastAt = Math.max(now, this.lastAt + 1);
    return this.lastAt;
  }

  private async call<T>(
    op: AccessOp,
    fields: Record<string, unknown>,
    schema: z.ZodType<T>,
    grant?: AccessGrant,
  ): Promise<AccessResult<T>> {
    const nonce = randomBytes(16).toString('hex');
    const body: Record<string, unknown> = {
      v: ACCESS_VERSION,
      op,
      nonce,
      computer: this.o.computer,
      ...fields,
    };
    if (grant) {
      body['gmail'] = grant.gmail;
      body['grantId'] = grant.grantId;
      body['at'] = this.nextAt();
      body['mac'] = accessMac(grant.secret, body);
    }
    const sent = await this.send(JSON.stringify(body));
    return typeof sent === 'string' ? this.believe(sent, op, nonce, schema) : sent;
  }

  /** Whether Drashti may ask this address: the list's own (first), or Google's (a redirect). */
  private allowed(url: string, first: boolean): boolean {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    if (this.local)
      return u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.origin === new URL(this.o.url).origin;
    if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') return false;
    return first ? ACCESS_LIST_URL_SHAPE.test(url) : GOOGLE_HOSTS.has(u.hostname);
  }

  /** The call sent, and Google's redirect followed: the answer's text, or why there is none. */
  private async send(body: string): Promise<string | AccessResult<never>> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let url = this.o.url;
    let method: 'GET' | 'POST' = 'POST';
    let payload: string | null = body;
    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!this.allowed(url, hop === 0))
          return hop === 0
            ? noAnswer('address', 'Not the access list’s own address over HTTPS: nothing was sent.')
            : noAnswer('redirect', 'Sent on to an address that is not Google’s: not followed.');
        const reply = await this.o.transport({ method, url, body: payload, signal });
        if ([301, 302, 303, 307, 308].includes(reply.status)) {
          reply.cancel();
          if (!reply.location)
            return noAnswer('http', `A redirect (${String(reply.status)}) with no address.`);
          url = new URL(reply.location, url).toString();
          // As a browser does: on to the answer with a GET, but for 307 and 308, which repeat the call.
          if (reply.status !== 307 && reply.status !== 308) {
            method = 'GET';
            payload = null;
          }
          continue;
        }
        if (reply.status !== 200) {
          reply.cancel();
          return noAnswer('http', `The list answered HTTP ${String(reply.status)}.`);
        }
        return await reply.text(MAX_ANSWER_CHARS);
      }
      return noAnswer('redirect', 'Sent on too many times.');
    } catch (error) {
      if (signal.aborted) return noAnswer('timeout', `No answer within ${String(this.timeoutMs / 1000)} s.`);
      return noAnswer('network', error instanceof Error ? error.message : String(error));
    }
  }

  /** The answer believed, or not (see the top of this file). */
  private believe<T>(text: string, op: AccessOp, nonce: string, schema: z.ZodType<T>): AccessResult<T> {
    let outer: unknown;
    try {
      outer = JSON.parse(text);
    } catch {
      return noAnswer('unreadable', 'The answer is not JSON.');
    }
    const o = outerSchema.safeParse(outer);
    if (!o.success) return noAnswer('unreadable', 'The answer is not { payload, sig }.');
    if (o.data.sig === '') return noAnswer('unsigned', 'The answer is not signed (is the list set up?).');
    let good: boolean;
    try {
      good = verify(
        'sha256',
        Buffer.from(o.data.payload, 'utf8'),
        this.key,
        Buffer.from(o.data.sig, 'base64'),
      );
    } catch {
      good = false;
    }
    if (!good) return noAnswer('signature', 'The answer is not signed with the list’s key.');
    let payload: unknown;
    try {
      payload = JSON.parse(o.data.payload);
    } catch {
      return noAnswer('unexpected', 'The signed answer is not JSON.');
    }
    const head = headSchema.safeParse(payload);
    if (
      !head.success ||
      head.data.v !== ACCESS_VERSION ||
      head.data.op !== op ||
      head.data.nonce !== nonce ||
      head.data.computerId !== this.o.computer.id
    )
      return noAnswer('not-ours', 'A signed answer, but not to this call from this computer.');
    if (!head.data.ok) {
      const refused = refusalSchema.safeParse(payload);
      return refused.success
        ? { ok: false, kind: 'refused', error: refused.data.error, message: refused.data.message }
        : noAnswer('unexpected', 'A refusal this Drashti does not know.');
    }
    const value = schema.safeParse(payload);
    return value.success
      ? { ok: true, value: value.data, serverTime: head.data.serverTime }
      : noAnswer('unexpected', 'An answer in a form this Drashti does not know.');
  }
}

/** A signed call's mac: HMAC-SHA-256 with the computer's secret over the call's canonical JSON, without its mac. */
export function accessMac(secret: string, body: Record<string, unknown>): string {
  const { mac: _mac, ...rest } = body;
  return createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(`${ACCESS_MAC_PREFIX}${canonicalJson(rest)}`, 'utf8')
    .digest('hex');
}

/** Where Drashti asks: the list built in, or (tests only, never packaged) the stand-in on 127.0.0.1. */
export interface AccessTarget {
  url: string;
  publicKey: string;
  /** The stand-in on http://127.0.0.1 (the test switches). */
  local: boolean;
}

/**
 * The list Drashti asks. A packaged Drashti asks only the one built in (src/shared/access-config.ts); in
 * development and the tests, DRASHTI_TEST_ACCESS_URL (an address on 127.0.0.1) and DRASHTI_TEST_ACCESS_KEY
 * (its public key) point it at the stand-in list instead. Null when there is none to ask: placeholders built
 * in (a release refuses them), or a test switch that is not 127.0.0.1's.
 */
export function accessTarget(o: { packaged: boolean; switches: Switches }): AccessTarget | null {
  const testUrl = o.packaged ? undefined : o.switches('DRASHTI_TEST_ACCESS_URL');
  if (testUrl !== undefined) {
    const key = o.switches('DRASHTI_TEST_ACCESS_KEY') ?? '';
    let u: URL;
    try {
      u = new URL(testUrl);
    } catch {
      return null;
    }
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' && accessKeyShaped(key)
      ? { url: testUrl, publicKey: key, local: true }
      : null;
  }
  return accessConfigReal()
    ? { url: ACCESS_LIST_URL, publicKey: ACCESS_LIST_PUBLIC_KEY, local: false }
    : null;
}
