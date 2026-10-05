import type { IncomingMessage } from 'node:http';
import { request } from 'node:https';
import { connect, type PeerCertificate } from 'node:tls';
import WebSocket from 'ws';
import { ENGINE_STATE_VERSION } from '../../shared/engine/state';
import { clockOffset } from '../../shared/network';
import {
  DEFAULT_NODE_PORT,
  type FromNode,
  type LinkState,
  NODE_BYE_TEXT,
  NODE_PATHS,
  NODE_PROTOCOL,
  type NodeByeReason,
  type NodeClock,
  type NodeHealth,
  type PairFinishAnswer,
  type PairStartAnswer,
  type ToNode,
  versionMismatch,
} from '../../shared/nodes';
import { certificateFingerprint, toPem } from '../nodes/certificate';
import { confirmation, pakeKey, sameConfirmation, startPake } from '../nodes/pake';

/*
 * The node link, a node's side (Session 13). Pairing reads Main's
 * certificate, then runs the key exchange (pake.ts) over a connection that
 * trusts that one certificate; the code proves both sides saw it. From then
 * on every connection to Main trusts only the pinned certificate: a computer
 * answering at Main's address with any other is refused before a word is
 * said. The feed reconnects by itself, trying each of Main's addresses.
 */

export interface PinnedMain {
  id: string;
  name: string;
  certPem: string;
  fingerprint: string;
  /** Where to find it, the address typed at pairing first. */
  addresses: string[];
  port: number;
}

/** A computer answered with another certificate than the pinned one. */
export class NotOurMain extends Error {
  constructor(address: string) {
    super(
      `The computer at ${address} is not the Main this node paired with (its certificate is different), so it is refused.`,
    );
  }
}

const TLS_REFUSALS = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_SIGNATURE_FAILURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_UNTRUSTED',
]);

/**
 * A certificate refused for its dates: one of the two computers has a badly
 * wrong date (the node's clock before the day Main made its certificate, or
 * Main's clock wrong when it made it). Not a stranger: the clocks.
 */
const DATE_REFUSALS = new Set(['CERT_NOT_YET_VALID', 'CERT_HAS_EXPIRED']);

export function isClockRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && DATE_REFUSALS.has(code);
}

/** What a refusal for the dates means, in words. */
export function clockRefusal(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const how =
    code === 'CERT_HAS_EXPIRED'
      ? 'by this computer’s date, Main’s certificate has run out'
      : 'by this computer’s date, Main’s certificate is not valid yet';
  return `This computer and Main disagree about the date (${how}), so they cannot connect securely. Check the date and time on both computers. Trying again…`;
}

/** Was this connection refused for its certificate (another computer posing as Main)? */
export function isCertificateRefusal(error: unknown): boolean {
  if (error instanceof NotOurMain) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return (
    (typeof code === 'string' && TLS_REFUSALS.has(code)) ||
    (error instanceof Error && error.message.includes('not the Main this node paired with'))
  );
}

/** TLS options that trust exactly Main's own certificate, whatever its name or address. */
export function pinnedTls(main: { certPem: string; fingerprint: string }, address: string) {
  return {
    ca: [main.certPem],
    minVersion: 'TLSv1.3' as const,
    rejectUnauthorized: true,
    checkServerIdentity: (_host: string, cert: PeerCertificate) =>
      certificateFingerprint(cert.raw) === main.fingerprint ? undefined : new NotOurMain(address),
  };
}

/** "192.168.1.20", "mandir-mac.local:8741", "[fe80::1]": the host and port to connect to. */
export function parseMainAddress(input: string, defaultPort: number): { host: string; port: number } | null {
  const text = input
    .trim()
    .replace(/^https?:\/\//iu, '')
    .replace(/\/.*$/u, '');
  if (text === '' || text.length > 255) return null;
  const v6 = /^\[([0-9a-f:.%]+)\](?::(\d{1,5}))?$/iu.exec(text);
  if (v6?.[1]) return { host: v6[1], port: v6[2] ? Number(v6[2]) : defaultPort };
  const m = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/u.exec(text);
  if (!m?.[1]) return null;
  const port = m[2] ? Number(m[2]) : defaultPort;
  return port >= 1 && port <= 65535 ? { host: m[1], port } : null;
}

const hostForUrl = (host: string) => (host.includes(':') ? `[${host}]` : host);

/** What a failed connection means, in words. */
function unreachable(error: unknown, where: string): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ECONNREFUSED')
    return `Nothing answered at ${where}. Check the address, and that Drashti on Main is offering a code (Screens, Pair a node).`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `No computer is called ${where} on this network.`;
  return `Main could not be reached at ${where}${typeof code === 'string' ? ` (${code})` : ''}.`;
}

/** Main's certificate, as it presents it now (pairing only: nothing is trusted yet). */
function readCertificate(host: string, port: number): Promise<{ pem: string; fingerprint: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(
      { host, port, rejectUnauthorized: false, minVersion: 'TLSv1.3', timeout: 5000 },
      () => {
        const cert = socket.getPeerCertificate(true);
        socket.end();
        if (!(cert.raw instanceof Buffer)) reject(new Error('Main sent no certificate.'));
        else resolve({ pem: toPem(cert.raw), fingerprint: certificateFingerprint(cert.raw) });
      },
    );
    socket.on('timeout', () => {
      socket.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
    });
    socket.on('error', reject);
  });
}

function postJson(
  host: string,
  port: number,
  path: string,
  body: unknown,
  tls: ReturnType<typeof pinnedTls>,
): Promise<{ status: number; json: unknown }> {
  const text = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host,
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) },
        timeout: 10_000,
        agent: false,
        ...tls,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              json: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
            });
          } catch {
            reject(new Error('Main’s answer was not understood.'));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(text);
  });
}

export type PairResult =
  | { ok: true; main: PinnedMain & { version: string }; token: string; node: { id: string; name: string } }
  | { ok: false; message: string; mainVersion?: string };

/** Pair with Main at this address, with the code it shows. Nothing is kept unless both sides prove the code. */
export async function pairWithMain(input: {
  address: string;
  defaultPort: number;
  code: string;
  name: string;
  version: string;
}): Promise<PairResult> {
  const where = parseMainAddress(input.address, input.defaultPort);
  if (!where) return { ok: false, message: 'Type Main’s address as it shows it, for example 192.168.1.20.' };
  const code = input.code.replace(/\s+/gu, '');
  if (!/^\d{6}$/u.test(code)) return { ok: false, message: 'Type the six-digit code Main shows.' };
  const label = `${where.host}${where.port === input.defaultPort ? '' : `:${where.port}`}`;
  let cert: { pem: string; fingerprint: string };
  try {
    cert = await readCertificate(where.host, where.port);
  } catch (error) {
    return { ok: false, message: unreachable(error, label) };
  }
  // The rest over a connection that trusts only the certificate just read (it cannot change halfway).
  const tls = pinnedTls({ certPem: cert.pem, fingerprint: cert.fingerprint }, label);
  const own = startPake(code, cert.fingerprint);
  try {
    const started = (await postJson(
      where.host,
      where.port,
      NODE_PATHS.pairStart,
      {
        x: own.share,
        name: input.name,
        version: input.version,
        protocol: NODE_PROTOCOL,
      },
      tls,
    )) as { status: number; json: PairStartAnswer };
    if (!started.json.ok)
      return { ok: false, message: started.json.message, mainVersion: started.json.mainVersion };
    const key = pakeKey(own, started.json.y, {
      fingerprint: cert.fingerprint,
      nodeShare: own.share,
      mainShare: started.json.y,
    });
    if (!key) return { ok: false, message: 'Main’s answer was not a pairing message.' };
    const finished = (await postJson(
      where.host,
      where.port,
      NODE_PATHS.pairFinish,
      {
        session: started.json.session,
        confirm: confirmation(key, 'node'),
      },
      tls,
    )) as { status: number; json: PairFinishAnswer };
    if (!finished.json.ok) return { ok: false, message: finished.json.message };
    if (!sameConfirmation(finished.json.confirm, confirmation(key, 'main')))
      return {
        ok: false,
        message: 'Main could not prove it knows the code, so this node did not pair with it.',
      };
    if (started.json.main.version !== input.version)
      return {
        ok: false,
        message: versionMismatch(started.json.main.version, input.version),
        mainVersion: started.json.main.version,
      };
    return {
      ok: true,
      main: {
        id: started.json.main.id,
        name: started.json.main.name,
        version: started.json.main.version,
        certPem: cert.pem,
        fingerprint: cert.fingerprint,
        addresses: [where.host],
        port: where.port,
      },
      token: finished.json.token,
      node: finished.json.node,
    };
  } catch (error) {
    if (isClockRefusal(error))
      return { ok: false, message: clockRefusal(error).replace(' Trying again…', '') };
    if (isCertificateRefusal(error))
      return { ok: false, message: 'Main’s certificate changed while pairing. Try again.' };
    return { ok: false, message: unreachable(error, label) };
  }
}

/** A media file from Main, from a byte on (to carry on after a drop), over the pinned connection. */
export function openMediaFromMain(
  main: PinnedMain,
  host: string,
  token: string,
  mediaId: string,
  fromByte: number,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host,
        port: main.port,
        path: `${NODE_PATHS.media}${encodeURIComponent(mediaId)}`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(fromByte > 0 ? { Range: `bytes=${fromByte}-` } : {}),
        },
        timeout: 20_000,
        agent: false,
        ...pinnedTls(main, host),
      },
      resolve,
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

// ---- the feed ------------------------------------------------------------------------------

export interface LinkEvents {
  /** How the link stands, and why (in words) when it is not online. */
  state(state: LinkState, why: string | null): void;
  welcome(main: { id: string; name: string; version: string; addresses: string[] }, session: string): void;
  message(message: ToNode): void;
  clock(clock: NodeClock): void;
  /** Main removed this node (or no longer knows it): its pairing is gone. */
  removed(reason: NodeByeReason): void;
  /** Main refused this node for its version: Main's version (Session 14: the node offers to match it). */
  refusedVersion?(mainVersion: string | null): void;
}

/** After a drop: try again soon, then every couple of seconds (a node should be back as soon as Main is). */
const WAITS_MS = [500, 1000, 2000, 2000, 3000];
/** Once refused for its version, try now and then (Main may have been updated). */
const REFUSED_WAIT_MS = 30_000;
const CLOCK_EVERY_MS = 5000;

export class LinkClient {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retry: NodeJS.Timeout | null = null;
  private clockTimer: NodeJS.Timeout | null = null;
  private samples: { t0: number; t1: number; server: number }[] = [];
  private stopped = false;
  private lastBye: { reason: NodeByeReason; mainVersion?: string } | null = null;
  private addressIndex = 0;
  /** The address the open connection reached Main at (media are fetched from there too). */
  private reachedAt: string | null = null;

  constructor(
    private main: PinnedMain,
    private readonly token: string,
    private readonly version: string,
    private readonly events: LinkEvents,
    /** This computer's clock (tests move it, to stand in for another computer's). */
    private readonly localNow: () => number = Date.now,
  ) {}

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.retry = null;
    this.clockTimer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.terminate();
  }

  /** Main's addresses changed (it told us where else it can be found). */
  setAddresses(addresses: string[]): void {
    const first = this.main.addresses[0];
    const all = [...new Set([...(first ? [first] : []), ...addresses])].slice(0, 8);
    this.main = { ...this.main, addresses: all };
  }

  get pinned(): PinnedMain {
    return this.main;
  }

  get online(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Where Main answered last (or the first address to try). */
  get host(): string {
    return this.reachedAt ?? this.main.addresses[0] ?? '';
  }

  send(message: FromNode): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  sendHealth(health: NodeHealth): void {
    this.send({ type: 'health', health });
  }

  private open(): void {
    this.retry = null;
    if (this.stopped) return;
    const host = this.main.addresses[this.addressIndex % Math.max(1, this.main.addresses.length)] ?? '';
    const label = `${host}${this.main.port === DEFAULT_NODE_PORT ? '' : `:${this.main.port}`}`;
    this.events.state('connecting', null);
    this.lastBye = null;
    let failure: unknown = null;
    const reached = host;
    // ws hands these on to Node's TLS as they are (its own types know an older checkServerIdentity).
    const tls = pinnedTls(this.main, label) as unknown as WebSocket.ClientOptions;
    const ws = new WebSocket(`wss://${hostForUrl(host)}:${this.main.port}${NODE_PATHS.feed}`, {
      ...tls,
      handshakeTimeout: 5000,
      maxPayload: 64 * 1024 * 1024,
      perMessageDeflate: false,
    });
    this.ws = ws;
    ws.on('open', () => {
      this.reachedAt = reached;
      ws.send(
        JSON.stringify({
          type: 'hello',
          token: this.token,
          version: this.version,
          protocol: NODE_PROTOCOL,
          engine: ENGINE_STATE_VERSION,
        } satisfies FromNode),
      );
    });
    ws.on('message', (data) => {
      let message: ToNode;
      try {
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(data);
        message = JSON.parse(bytes.toString('utf8')) as ToNode;
      } catch {
        return;
      }
      this.receive(message);
    });
    ws.on('error', (error) => {
      failure = error;
    });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.clockTimer) clearInterval(this.clockTimer);
      this.clockTimer = null;
      if (this.stopped) return;
      const bye = this.lastBye;
      if (bye?.reason === 'revoked' || bye?.reason === 'unauthorized') {
        this.events.state('unpaired', NODE_BYE_TEXT[bye.reason]);
        this.events.removed(bye.reason);
        return;
      }
      if (bye?.reason === 'version') {
        this.events.refusedVersion?.(bye.mainVersion ?? null);
        this.events.state('refused', versionMismatch(bye.mainVersion ?? '?', this.version));
        this.retry = setTimeout(() => {
          this.open();
        }, REFUSED_WAIT_MS);
        return;
      }
      // A clock so wrong that Main's certificate is out of its dates: said plainly, and tried again
      // as any drop is (someone may fix the date at any moment).
      const clock = isClockRefusal(failure);
      const why = clock
        ? clockRefusal(failure)
        : isCertificateRefusal(failure)
          ? new NotOurMain(label).message
          : bye
            ? NODE_BYE_TEXT[bye.reason]
            : failure
              ? unreachable(failure, label)
              : 'The connection to Main was lost.';
      if (clock || isCertificateRefusal(failure)) this.events.state('refused', why);
      else this.events.state('offline', why);
      this.addressIndex++;
      const wait = WAITS_MS[Math.min(this.attempt, WAITS_MS.length - 1)] ?? 3000;
      this.attempt++;
      this.retry = setTimeout(() => {
        this.open();
      }, wait);
    });
  }

  private receive(message: ToNode): void {
    switch (message.type) {
      case 'welcome':
        this.attempt = 0;
        this.setAddresses(message.main.addresses);
        this.events.welcome(message.main, message.session);
        this.events.state('online', null);
        this.startClock();
        return;
      case 'clock': {
        this.samples.push({ t0: message.t0, t1: this.localNow(), server: message.server });
        if (this.samples.length > 12) this.samples.shift();
        const best = this.samples.reduce<{ rtt: number } | null>((b, s) => {
          const rtt = s.t1 - s.t0;
          return rtt >= 0 && (!b || rtt < b.rtt) ? { rtt } : b;
        }, null);
        const offset = clockOffset(this.samples);
        if (offset !== null && best)
          this.events.clock({ offsetMs: offset, rttMs: best.rtt, at: message.server });
        return;
      }
      case 'bye':
        this.lastBye = { reason: message.reason, mainVersion: message.mainVersion };
        return;
      default:
        this.events.message(message);
    }
  }

  private ping = (): void => {
    this.send({ type: 'clock', t0: this.localNow() });
  };

  private startClock(): void {
    this.samples = [];
    for (let i = 0; i < 6; i++) setTimeout(this.ping, i * 120);
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = setInterval(this.ping, CLOCK_EVERY_MS);
  }
}
