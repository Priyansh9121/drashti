import { randomUUID } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:https';
import { type Duplex, Transform, type TransformCallback } from 'node:stream';
import { type WebSocket, WebSocketServer } from 'ws';
import { EngineMirror } from '../../shared/engine/mirror';
import type { EngineMessage } from '../../shared/engine/protocol';
import { ENGINE_STATE_VERSION } from '../../shared/engine/state';
import { MEDIA_ID_PATTERN } from '../../shared/media';
import {
  type FromNode,
  type MediaWant,
  NODE_PATHS,
  NODE_PROTOCOL,
  type NodeByeReason,
  type NodeHealth,
  type NodeScreen,
  type PairFinishAnswer,
  type PairStartAnswer,
  type ToNode,
  versionMismatch,
} from '../../shared/nodes';
import { nodeHealthSchema, nodeNameFrom, pairFinishSchema, pairStartSchema } from '../../shared/nodes-schema';
import { isLocalAddress, isLoopback, plainAddress } from '../network/addresses';
import { RateLimiter, WrongCodeLimiter } from '../network/limits';
import { hashToken, newToken } from '../network/tokens';
import { confirmation, pakeKey, sameConfirmation, startPake } from './pake';

/*
 * The node link, Main's side (Session 13): HTTPS and a WebSocket feed on a
 * port of their own (8741), with Main's own certificate. It runs in a
 * utility process (link-worker.ts), as the phones' server does, so the main
 * process only hands it each engine message once.
 *
 * - Pairing: the code Main offers (2 minutes, once) drives the key exchange
 *   in pake.ts, bound to this certificate; ten wrong tries drop the code.
 *   The node gets a token of its own; Main keeps only its hash.
 * - The feed: a node says hello with its token and version; a node on
 *   another version is refused, saying why. It gets the whole state, then
 *   each change, the screens it shows, the media it should have, and asks
 *   for the time; it sends its health and, while the dashboard is open,
 *   small pictures of its screens.
 * - Media: a paired node fetches a file by id, by range (to carry on after a
 *   drop), at a limited rate so copying never slows the show.
 * Only this computer and the local network may connect, and no browser.
 */

export interface LinkOptions {
  port: number;
  /** Every interface ('0.0.0.0'), or this computer only in tests. */
  bind: string;
  cert: string;
  key: string;
  fingerprint: string;
  main: { id: string; name: string; version: string };
  /** Where nodes can reach Main (sent to each, so it can find Main again if its number changes). */
  addresses: string[];
  /** This run of Main's engine. */
  session: string;
  /** Media copied at most this fast (bytes a second). */
  bytesPerSecond: number;
  /** Tests: treat this computer as outside the local network. */
  refuseLoopback?: boolean;
}

/** A paired node, as the link knows it: enough to check its token. */
export interface LinkNode {
  id: string;
  name: string;
  tokenHash: string;
}

export interface LinkHost {
  /** A node proved the code: keep it (its token's hash). Its id and name, or null if it could not be kept. */
  paired(node: {
    name: string;
    tokenHash: string;
    address: string;
    version: string;
  }): Promise<{ id: string; name: string } | null>;
  /** The code's wrong tries ran out: it is no longer offered. */
  offerDropped(): void;
  /** A media file to copy to a node: where it is, its hash and size; null when there is none. */
  mediaFile(mediaId: string): Promise<{ path: string; sha256: string; bytes: number; ext: string } | null>;
  online(nodeId: string, address: string, version: string): void;
  offline(nodeId: string): void;
  health(nodeId: string, health: NodeHealth): void;
  thumb(nodeId: string, screenId: string, jpeg: string): void;
  /** A paired node said hello on another version: refused. */
  refused(nodeId: string, version: string): void;
  /** This copy of the engine state fell behind: send a fresh snapshot. */
  resync(): void;
  log(level: 'info' | 'warn', message: string): void;
}

export type LinkStartResult = { ok: true; port: number } | { ok: false; message: string };

/** What the link has sent, for the performance check's bandwidth figures. */
export interface LinkStats {
  feedBytes: number;
  feedMessages: number;
  mediaBytes: number;
  since: number;
}

const MAX_BODY = 4 * 1024;
const MAX_FEED_MESSAGE = 512 * 1024;
const MAX_CLIENTS = 120;
const MAX_CLIENTS_PER_ADDRESS = 4;
const MAX_BUFFERED = 8 * 1024 * 1024;
const HELLO_WITHIN_MS = 5000;
/** A node that answers no ping for two beats is gone: the dashboard says so within about 10 s. */
const HEARTBEAT_MS = 5000;
/** A pairing's two steps must follow within this. */
const PAIRING_STEP_MS = 30_000;
const MAX_PAIRINGS = 20;
/** Wrong tries before a code is dropped. */
const WRONG_TRIES = 10;
const THUMB_MAX = 400 * 1024;

/** Media at a limited rate, shared by every copy going out: a token bucket of bytes. */
export class RateGate {
  private tokens: number;
  private at = performance.now();

  constructor(private rate: number) {
    this.tokens = rate / 4;
  }

  setRate(bytesPerSecond: number): void {
    this.rate = Math.max(64 * 1024, bytesPerSecond);
  }

  /** Take `n` bytes: how long to wait before sending them (ms). */
  take(n: number): number {
    const now = performance.now();
    this.tokens = Math.min(this.rate / 4, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    this.tokens -= n;
    return this.tokens >= 0 ? 0 : (-this.tokens / this.rate) * 1000;
  }
}

class Throttle extends Transform {
  constructor(
    private readonly gate: RateGate,
    private readonly sent: (n: number) => void,
  ) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    const wait = this.gate.take(chunk.length);
    const pass = () => {
      this.sent(chunk.length);
      done(null, chunk);
    };
    if (wait <= 0) pass();
    else setTimeout(pass, wait);
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

interface Client {
  ws: WebSocket;
  address: string;
  node: LinkNode | null;
  alive: boolean;
}

interface Pairing {
  key: Buffer;
  code: string;
  name: string;
  version: string;
  address: string;
  expiresAt: number;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? '0') > MAX_BODY) {
      req.resume();
      reject(new HttpError(413, 'That request is too large.'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) reject(new HttpError(413, 'That request is too large.'));
      else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'That is not JSON.'));
      }
    });
    req.on('error', () => {
      reject(new HttpError(400, 'The request was cut short.'));
    });
  });
}

/** "bytes=100-" or "bytes=100-199" against a file's size; null for the whole file, 'bad' when it cannot be met. */
export function byteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | 'bad' {
  if (!header) return null;
  const m = /^bytes=(\d+)-(\d*)$/u.exec(header.trim());
  if (!m?.[1]) return 'bad';
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || start >= size || end < start) return 'bad';
  return { start, end };
}

export class LinkServer {
  private server: Server | null = null;
  private options: LinkOptions | null = null;
  private nodes = new Map<string, LinkNode>();
  private readonly clients = new Set<Client>();
  private readonly mirror = new EngineMirror();
  private offer: { code: string; expiresAt: number; wrong: number } | null = null;
  private readonly pairings = new Map<string, Pairing>();
  private readonly screens = new Map<string, NodeScreen[]>();
  private readonly wanted = new Map<string, MediaWant[]>();
  private thumbsEveryMs: number | null = null;
  private readonly wrongCodes = new WrongCodeLimiter();
  private readonly perAddress = new RateLimiter(20, 60);
  private readonly feedMessages = new RateLimiter(30, 90);
  private gate = new RateGate(30 * 1024 * 1024);
  private heartbeat: NodeJS.Timeout | null = null;
  private counts: LinkStats = { feedBytes: 0, feedMessages: 0, mediaBytes: 0, since: Date.now() };

  constructor(private readonly host: LinkHost) {}

  get listening(): boolean {
    return this.server?.listening ?? false;
  }

  start(options: LinkOptions): Promise<LinkStartResult> {
    this.options = options;
    this.gate = new RateGate(options.bytesPerSecond);
    const server = createServer(
      { key: options.key, cert: options.cert, minVersion: 'TLSv1.3' },
      (req, res) => {
        void this.onRequest(req, res);
      },
    );
    server.headersTimeout = 10_000;
    server.requestTimeout = 0;
    server.keepAliveTimeout = 5000;
    server.on('tlsClientError', () => undefined);
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FEED_MESSAGE, clientTracking: false });
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      this.onUpgrade(wss, req, socket, head);
    });
    return new Promise((resolve) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        resolve({
          ok: false,
          message:
            error.code === 'EADDRINUSE'
              ? `Port ${options.port} is in use by another program on this computer, so nodes cannot connect. Choose another port for nodes, or close that program.`
              : `Drashti could not listen for nodes on port ${options.port} (${error.code ?? error.message}).`,
        });
      });
      server.listen(options.port, options.bind, () => {
        this.server = server;
        this.heartbeat = setInterval(() => {
          this.beat();
        }, HEARTBEAT_MS);
        const address = server.address();
        resolve({ ok: true, port: typeof address === 'object' && address ? address.port : options.port });
      });
    });
  }

  stop(reason: NodeByeReason = 'closing'): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const c of this.clients) this.bye(c, reason);
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
      server.closeAllConnections();
    });
  }

  // ---- what the main process tells the link ------------------------------------------------

  /** The paired nodes (replacing the list): one no longer there is cut off at once. */
  setNodes(list: readonly LinkNode[]): void {
    this.nodes = new Map(list.map((n) => [n.tokenHash, n]));
    const ids = new Map(list.map((n) => [n.id, n]));
    for (const c of this.clients) {
      if (!c.node) continue;
      const now = ids.get(c.node.id);
      if (!now) this.bye(c, 'revoked');
      else c.node = now;
    }
  }

  setOffer(offer: { code: string; expiresAt: number } | null): void {
    this.offer = offer ? { ...offer, wrong: 0 } : null;
  }

  setRate(bytesPerSecond: number): void {
    this.gate.setRate(bytesPerSecond);
  }

  engine(message: EngineMessage): void {
    const result = this.mirror.apply(message);
    if (result === 'resync') {
      this.host.resync();
      return;
    }
    if (result !== 'applied') return;
    const text = JSON.stringify({ type: 'engine', message } satisfies ToNode);
    for (const c of this.clients) if (c.node) this.sendText(c, text);
  }

  setScreens(nodeId: string, screens: NodeScreen[]): void {
    this.screens.set(nodeId, screens);
    this.toNode(nodeId, { type: 'screens', screens });
  }

  setWanted(nodeId: string, wanted: MediaWant[]): void {
    this.wanted.set(nodeId, wanted);
    this.toNode(nodeId, { type: 'media', wanted });
  }

  setThumbs(everyMs: number | null): void {
    this.thumbsEveryMs = everyMs;
    for (const c of this.clients) if (c.node) this.send(c, { type: 'thumbs', everyMs });
  }

  toNode(nodeId: string, message: ToNode): void {
    for (const c of this.clients) if (c.node?.id === nodeId) this.send(c, message);
  }

  stats(): LinkStats {
    return { ...this.counts };
  }

  resetStats(): void {
    this.counts = { feedBytes: 0, feedMessages: 0, mediaBytes: 0, since: Date.now() };
  }

  // ---- HTTPS ---------------------------------------------------------------------------------

  private addressAllowed(address: string): boolean {
    if (this.options?.refuseLoopback && isLoopback(address)) return false;
    return isLocalAddress(address);
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const address = plainAddress(req.socket.remoteAddress ?? '');
    try {
      if (!this.addressAllowed(address))
        throw new HttpError(403, 'Only computers on this local network can reach Drashti.');
      // Nodes are Drashti itself, never a browser page.
      if (req.headers.origin !== undefined) throw new HttpError(403, 'Browsers are refused here.');
      if (!this.perAddress.take(address)) throw new HttpError(429, 'Too many requests: wait a moment.');
      const path = (req.url ?? '').split('?')[0] ?? '';
      if (path === NODE_PATHS.pairStart && req.method === 'POST') {
        this.json(res, 200, await this.pairStart(req, address));
        return;
      }
      if (path === NODE_PATHS.pairFinish && req.method === 'POST') {
        this.json(res, 200, await this.pairFinish(req, address));
        return;
      }
      if (path.startsWith(NODE_PATHS.media) && req.method === 'GET') {
        await this.media(req, res, path.slice(NODE_PATHS.media.length));
        return;
      }
      throw new HttpError(404, 'There is no such request.');
    } catch (error) {
      if (error instanceof HttpError)
        this.json(res, error.status, { ok: false, message: error.message, ...error.extra });
      else {
        this.host.log('warn', `A node request failed: ${(error as Error).message}`);
        this.json(res, 500, { ok: false, message: 'Something went wrong on Main.' });
      }
    }
  }

  private async pairStart(req: IncomingMessage, address: string): Promise<PairStartAnswer> {
    const options = this.options;
    if (!options) throw new HttpError(503, 'Main is not ready.');
    if (!this.wrongCodes.allowed(address))
      throw new HttpError(429, 'Too many wrong codes. Wait a minute, then ask for a new code on Main.');
    const body = pairStartSchema.safeParse(await readJson(req));
    if (!body.success) throw new HttpError(400, 'That is not a pairing request.');
    if (body.data.protocol !== NODE_PROTOCOL || body.data.version !== options.main.version)
      throw new HttpError(409, versionMismatch(options.main.version, body.data.version), {
        mainVersion: options.main.version,
      });
    const offer = this.offer;
    if (!offer || offer.expiresAt <= Date.now())
      throw new HttpError(
        403,
        'Main is not offering a code for a node now. On Main, open Screens, then Pair a node, and type the code it shows.',
      );
    const own = startPake(offer.code, options.fingerprint);
    const key = pakeKey(own, body.data.x, {
      fingerprint: options.fingerprint,
      nodeShare: body.data.x,
      mainShare: own.share,
    });
    if (!key) throw new HttpError(400, 'That is not a pairing request.');
    const now = Date.now();
    for (const [id, p] of this.pairings) if (p.expiresAt <= now) this.pairings.delete(id);
    if (this.pairings.size >= MAX_PAIRINGS)
      throw new HttpError(429, 'Too many pairings at once: wait a moment.');
    const session = randomUUID();
    this.pairings.set(session, {
      key,
      code: offer.code,
      name: nodeNameFrom(body.data.name),
      version: body.data.version,
      address,
      expiresAt: now + PAIRING_STEP_MS,
    });
    return { ok: true, session, y: own.share, main: options.main };
  }

  private async pairFinish(req: IncomingMessage, address: string): Promise<PairFinishAnswer> {
    const body = pairFinishSchema.safeParse(await readJson(req));
    if (!body.success) throw new HttpError(400, 'That is not a pairing request.');
    const pairing = this.pairings.get(body.data.session);
    this.pairings.delete(body.data.session);
    if (!pairing || pairing.expiresAt <= Date.now() || pairing.address !== address)
      throw new HttpError(403, 'That pairing took too long. Try again.');
    const wrong = new HttpError(403, 'That code is wrong or has expired. Ask for a new code on Main.');
    if (!sameConfirmation(body.data.confirm, confirmation(pairing.key, 'node'))) {
      this.wrongCodes.failed(address);
      const offer = this.offer;
      if (offer?.code === pairing.code && ++offer.wrong >= WRONG_TRIES) {
        this.offer = null;
        this.host.log('warn', 'A node pairing code was dropped after too many wrong tries');
        this.host.offerDropped();
      }
      throw wrong;
    }
    const offer = this.offer;
    if (offer?.code !== pairing.code || offer.expiresAt <= Date.now()) throw wrong;
    this.offer = null;
    const token = newToken();
    const tokenHash = hashToken(token);
    const node = await this.host.paired({
      name: pairing.name,
      tokenHash,
      address,
      version: pairing.version,
    });
    if (!node) throw new HttpError(500, 'Main could not keep this node.');
    this.nodes.set(tokenHash, { id: node.id, name: node.name, tokenHash });
    return { ok: true, confirm: confirmation(pairing.key, 'main'), token, node };
  }

  private authenticate(req: IncomingMessage): LinkNode | null {
    const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/u.exec((req.headers.authorization ?? '').trim());
    return match?.[1] ? (this.nodes.get(hashToken(match[1])) ?? null) : null;
  }

  private async media(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    if (!this.authenticate(req)) throw new HttpError(401, 'This node is not paired with Main.');
    if (!MEDIA_ID_PATTERN.test(id)) throw new HttpError(404, 'There is no such media item.');
    const file = await this.host.mediaFile(id);
    if (!file) throw new HttpError(404, 'There is no such media item.');
    let size: number;
    try {
      size = statSync(file.path).size;
    } catch {
      throw new HttpError(404, 'That file is missing on Main.');
    }
    const range = byteRange(req.headers.range, size);
    if (range === 'bad') {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    res.writeHead(range ? 206 : 200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': size === 0 ? 0 : end - start + 1,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Drashti-Sha256': file.sha256,
      'X-Drashti-Ext': file.ext,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    });
    if (size === 0) {
      res.end();
      return;
    }
    const stream = createReadStream(file.path, { start, end, highWaterMark: 64 * 1024 });
    const throttle = new Throttle(this.gate, (n) => {
      this.counts.mediaBytes += n;
    });
    stream.on('error', () => res.destroy());
    res.on('close', () => {
      stream.destroy();
      throttle.destroy();
    });
    stream.pipe(throttle).pipe(res);
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      'Cache-Control': 'no-store',
      ...(status === 413 ? { Connection: 'close' } : {}),
    });
    res.end(text);
  }

  // ---- the feed ------------------------------------------------------------------------------

  private onUpgrade(wss: WebSocketServer, req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const refuse = (status: number, text: string) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    socket.on('error', () => socket.destroy());
    const address = plainAddress(req.socket.remoteAddress ?? '');
    if (!this.addressAllowed(address) || req.headers.origin !== undefined) {
      refuse(403, 'Forbidden');
      return;
    }
    if ((req.url ?? '').split('?')[0] !== NODE_PATHS.feed) {
      refuse(404, 'Not Found');
      return;
    }
    // A node has an address of its own; this computer itself may run several (the performance
    // check's simulated nodes, or a node beside Main to try it), within the overall limit.
    const fromHere = [...this.clients].filter((c) => c.address === address).length;
    if (this.clients.size >= MAX_CLIENTS || (!isLoopback(address) && fromHere >= MAX_CLIENTS_PER_ADDRESS)) {
      refuse(503, 'Service Unavailable');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      this.onConnection(ws, address);
    });
  }

  private onConnection(ws: WebSocket, address: string): void {
    const client: Client = { ws, address, node: null, alive: true };
    this.clients.add(client);
    const hello = setTimeout(() => {
      if (!client.node) this.bye(client, 'unauthorized');
    }, HELLO_WITHIN_MS);
    const key = randomUUID();
    ws.on('message', (data, isBinary) => {
      if (isBinary || !this.feedMessages.take(key)) {
        ws.terminate();
        return;
      }
      let message: FromNode;
      try {
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(data);
        message = JSON.parse(bytes.toString('utf8')) as FromNode;
      } catch {
        ws.terminate();
        return;
      }
      this.onFeedMessage(client, message, hello);
    });
    ws.on('pong', () => {
      client.alive = true;
    });
    ws.on('close', () => {
      clearTimeout(hello);
      this.clients.delete(client);
      const node = client.node;
      client.node = null;
      // Offline, unless it is connected again on another connection already.
      if (node && ![...this.clients].some((c) => c.node?.id === node.id)) this.host.offline(node.id);
    });
    ws.on('error', () => {
      ws.terminate();
    });
  }

  private onFeedMessage(client: Client, message: FromNode, hello: NodeJS.Timeout): void {
    const options = this.options;
    if (!options) return;
    if (!client.node) {
      if (message.type !== 'hello' || typeof message.token !== 'string' || message.token.length > 200) {
        this.bye(client, 'unauthorized');
        return;
      }
      const node = this.nodes.get(hashToken(message.token));
      if (!node) {
        this.bye(client, 'unauthorized');
        return;
      }
      clearTimeout(hello);
      const version = typeof message.version === 'string' ? message.version.slice(0, 40) : '?';
      if (
        version !== options.main.version ||
        message.protocol !== NODE_PROTOCOL ||
        message.engine !== ENGINE_STATE_VERSION
      ) {
        this.host.refused(node.id, version);
        this.host.log('warn', `Nodes: “${node.name}” runs Drashti ${version}; refused`);
        this.bye(client, 'version');
        return;
      }
      // One connection per node: an older one (a reconnect the old side has not noticed) goes.
      for (const other of this.clients)
        if (other !== client && other.node?.id === node.id) {
          other.node = null;
          this.bye(other, 'replaced');
        }
      client.node = node;
      this.send(client, {
        type: 'welcome',
        main: { ...options.main, addresses: options.addresses },
        node: { id: node.id, name: node.name },
        session: options.session,
      });
      this.sendSnapshot(client);
      this.send(client, { type: 'screens', screens: this.screens.get(node.id) ?? [] });
      this.send(client, { type: 'media', wanted: this.wanted.get(node.id) ?? [] });
      if (this.thumbsEveryMs !== null) this.send(client, { type: 'thumbs', everyMs: this.thumbsEveryMs });
      this.host.online(node.id, client.address, version);
      return;
    }
    const nodeId = client.node.id;
    switch (message.type) {
      case 'clock':
        if (typeof message.t0 === 'number' && Number.isFinite(message.t0))
          this.send(client, { type: 'clock', t0: message.t0, server: Date.now() });
        return;
      case 'resync':
        this.sendSnapshot(client);
        return;
      case 'health': {
        const health = nodeHealthSchema.safeParse(message.health);
        if (health.success) this.host.health(nodeId, health.data);
        return;
      }
      case 'thumb':
        if (
          typeof message.screenId === 'string' &&
          message.screenId.length <= 128 &&
          typeof message.jpeg === 'string' &&
          message.jpeg.length <= THUMB_MAX &&
          /^[A-Za-z0-9+/=]*$/u.test(message.jpeg)
        )
          this.host.thumb(nodeId, message.screenId, message.jpeg);
        return;
      case 'hello':
        return;
    }
  }

  private sendSnapshot(client: Client): void {
    const state = this.mirror.state;
    if (!state || !this.options) return;
    this.send(client, {
      type: 'engine',
      message: {
        kind: 'snapshot',
        version: ENGINE_STATE_VERSION,
        rev: this.mirror.rev,
        state,
        sentAt: Date.now(),
        session: this.mirror.session ?? this.options.session,
      },
    });
  }

  private send(client: Client, message: ToNode): void {
    this.sendText(client, JSON.stringify(message));
  }

  private sendText(client: Client, text: string): void {
    if (client.ws.readyState !== client.ws.OPEN) return;
    if (client.ws.bufferedAmount > MAX_BUFFERED) {
      this.bye(client, 'too-slow');
      return;
    }
    this.counts.feedBytes += Buffer.byteLength(text);
    this.counts.feedMessages += 1;
    client.ws.send(text);
  }

  private bye(client: Client, reason: NodeByeReason): void {
    try {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(
          JSON.stringify({
            type: 'bye',
            reason,
            ...(reason === 'version' && this.options ? { mainVersion: this.options.main.version } : {}),
          } satisfies ToNode),
        );
        client.ws.close(4000, reason);
      }
    } catch {
      // Closing anyway.
    }
    setTimeout(() => {
      client.ws.terminate();
    }, 1000).unref();
  }

  private beat(): void {
    for (const c of this.clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        c.ws.terminate();
      }
    }
  }
}
