import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename } from 'node:path';
import type { Duplex } from 'node:stream';
import { type WebSocket, WebSocketServer } from 'ws';
import { STOPPED_REFUSAL } from '../../shared/access';
import { EngineMirror } from '../../shared/engine/mirror';
import type { EngineMessage } from '../../shared/engine/protocol';
import { ENGINE_STATE_VERSION } from '../../shared/engine/state';
import { MEDIA_ID_PATTERN } from '../../shared/media';
import {
  type ByeReason,
  DEVICE_KIND_LABEL,
  FEED_PATH,
  type FromDevice,
  type NetworkChange,
  type ToDevice,
} from '../../shared/network';
import {
  type DeviceAnswer,
  type DeviceAuth,
  type DeviceOp,
  type DeviceRequest,
  deviceMay,
  type PairAnswer,
} from '../../shared/network-api';
import {
  allowedHostNames,
  hostAllowed,
  isLocalAddress,
  isLoopback,
  localInterfaceAddresses,
  originAllowed,
} from './addresses';
import { RateLimiter, WrongCodeLimiter } from './limits';
import { MediaServing, sendFile } from './media-serving';
import { PreviewMaker, type PreviewSource } from './previews';
import { hashToken } from './tokens';
import { isPiece, UPLOAD_ROUTES, uploadAnswer, uploadsAt } from './upload-routes';
import type { Uploads } from './uploads';
import type { ArrivedFile, ArrivedOutcome, UploadPolicy } from '../../shared/phone-files';
import { apiQuery, apiSegments, listWebFiles, safeRequestPath, type WebFile } from './web-files';
import { COULD_NOT } from './messages';
import { mirrorRoutes } from './mirror-routes';

/*
 * Drashti's network server: HTTP and WebSocket on one port. It runs in a
 * utility process of its own (src/main/network/worker.ts), so the main
 * process, which carries every slide change, only hands it each engine
 * message once; this class does not mind which process it is in.
 *
 * Every request is checked before anything else: it must come from this
 * computer or the local network, name one of this computer's addresses in
 * its Host header, and (from a browser) come from Drashti's own pages. The
 * pages' code is served to anyone who passes that (it holds nothing
 * private); everything with data needs a paired device's token, in the
 * Authorization header or as the feed's first message. Never cookies.
 */

export interface ServerOptions {
  port: number;
  /** The address to listen on: every interface ('0.0.0.0'), or this computer only in tests. */
  bind: string;
  /** The built pages (out/renderer). */
  webDir: string;
  ffmpeg: string | null;
  /** Where thumbnails' previews are kept. */
  previewDir: string;
  /** This computer's name on the local network (name.local), or null. */
  localName: string | null;
  /** Tests: treat this computer as outside the local network, to see such requests refused. */
  refuseLoopback?: boolean;
  /** Tests: fewer connections at once than SOCKET_LIMITS. */
  sockets?: { total: number; perAddress: number };
  /** Files phones add (Session 54): the uploads folder, inside the media folder. None are taken without it. */
  uploads?: { dir: string; mediaDir: string };
}

export interface ServerHost {
  /** A device's request that the main process answers (it checks the device and kind again). */
  request(request: DeviceRequest): Promise<DeviceAnswer>;
  /** Exchange a pairing code for a new device and its token. */
  pair(code: string, address: string): Promise<PairAnswer>;
  /** A media item's file and kind, for a preview; null when there is none. */
  mediaSource(mediaId: string): Promise<PreviewSource | null>;
  /** A sound's file while a playlist shared with phones has it (Session 54, D3); null otherwise, or left out. */
  sharedSound?(mediaId: string): Promise<string | null>;
  /** The devices with the feed open now. */
  connected(deviceIds: string[]): void;
  /** A device asked for something (its "last seen"). */
  seen(deviceId: string): void;
  /** This copy of the engine state fell behind: send a fresh snapshot. */
  resync(): void;
  log(level: 'info' | 'warn', message: string): void;
  /** A file a phone added has all arrived and is what it should be (Session 54): the main process imports it. */
  arrived?(file: ArrivedFile): void;
}

export type StartResult = { ok: true; port: number } | { ok: false; message: string };

/** Limits: requests, bodies, connections and how far a slow phone may fall behind. */
const MAX_BODY = 16 * 1024;
const MAX_FEED_MESSAGE = 4 * 1024;
const MAX_CLIENTS = 100;
const MAX_CLIENTS_PER_ADDRESS = 10;
/**
 * Connections at once, pages, previews and feeds alike (Sessions 31–36, SEC-11), in all and from one
 * address: one more is closed at once. From one address there is room for 10 feeds and a browser's 6 page
 * fetches, and for the Performance check's 10 devices (each a feed and its fetches, all from this computer).
 */
export const SOCKET_LIMITS = { total: 256, perAddress: 32 } as const;
const MAX_BUFFERED = 1024 * 1024;
const HELLO_WITHIN_MS = 5000;
const HEARTBEAT_MS = 20_000;
const ID = /^[A-Za-z0-9_-]{1,128}$/u;

interface Client {
  id: string;
  ws: WebSocket;
  address: string;
  device: DeviceAuth | null;
  alive: boolean;
}

interface Route {
  method: 'GET' | 'POST';
  /** Segments; ':name' takes an id-like segment. */
  parts: string[];
  op: DeviceOp;
  args?: (body: Record<string, unknown>, params: Record<string, string>) => unknown;
  /** What a ':name' segment may be (an id-like one unless given). */
  param?: RegExp;
}

const route = (
  method: Route['method'],
  path: string,
  op: DeviceOp,
  args?: Route['args'],
  param?: RegExp,
): Route => ({
  method,
  parts: path.split('/').filter(Boolean),
  op,
  args,
  param,
});

/** A presentation's id, or a Shastra passage's ("shastra:pg#14", sent percent-encoded): both play alike. */
const PRESENTATION_ID =
  /^(?:[A-Za-z0-9_-]{1,128}|shastra:[^/#\s\\]{1,64}(?:\/[^/#\s\\]{1,160}){0,8}#\d{1,6}(?:-\d{1,6})?)$/u;

const command = (type: string) => () => ({ type });

/** The API (docs/api.md). Order matters where a fixed segment and a parameter could both match. */
const ROUTES: Route[] = [
  route('GET', '/api/v1/me', 'me'),
  route('GET', '/api/v1/status', 'status'),
  route('GET', '/api/v1/state', 'state'),
  route('GET', '/api/v1/stage', 'stage'),
  route('GET', '/api/v1/hall', 'hall'),
  route('GET', '/api/v1/playlists', 'playlists'),
  // The presenter's remote (Session 18): the library a page at a time, and searched.
  route('GET', '/api/v1/presentations', 'presentations', (q) => ({ offset: q['offset'], limit: q['limit'] })),
  route('GET', '/api/v1/search', 'search', (q) => ({ query: q['q'] })),
  route('GET', '/api/v1/playlists/:id/items', 'items', (_b, p) => ({ playlistId: p['id'] })),
  route(
    'GET',
    '/api/v1/presentations/:id',
    'presentation',
    (_b, p) => ({ presentationId: p['id'] }),
    PRESENTATION_ID,
  ),
  route('GET', '/api/v1/messages', 'messages'),
  route('GET', '/api/v1/timers', 'timers'),
  route('GET', '/api/v1/logo', 'logo'),
  route('GET', '/api/v1/media/:id/preview', 'preview', (_b, p) => ({ mediaId: p['id'] })),
  // Full quality (Session 54, D1): a picture at the width the device draws it, up to the original; a picture's or
  // video's own file in pieces as it plays (HTTP Range), and a link to it that a <video> can play.
  route('GET', '/api/v1/media/:id/picture', 'media.picture'),
  route('GET', '/api/v1/media/:id/original', 'media.original'),
  route('GET', '/api/v1/media/:id/link', 'media.original'),
  route('GET', '/api/v1/looks', 'looks'),
  route('POST', '/api/v1/looks/:id/live', 'command', (_b, p) => ({ type: 'setLook', lookId: p['id'] })),
  route('POST', '/api/v1/markers/:id/jump', 'command', (b, p) => ({
    type: 'jumpToMarker',
    layer: b['layer'] === 'audio' ? 'audio' : 'background',
    markerId: p['id'],
  })),
  // With an audio playlist chosen on a phone (Session 54, D5), or on from where it was paused.
  route('POST', '/api/v1/music/play', 'music.play', (b) => ({ playlistId: b['playlistId'] })),
  // The time bar (Session 54): what plays moved, paused or played on; the engine checks what `playing` names.
  route('POST', '/api/v1/playing/move', 'command', (b) => ({
    type: 'moveTo',
    playing: b['playing'],
    toMs: b['toMs'],
  })),
  route('POST', '/api/v1/playing/pause', 'command', (b) => ({ type: 'pausePlaying', playing: b['playing'] })),
  route('POST', '/api/v1/playing/play', 'command', (b) => ({ type: 'resumePlaying', playing: b['playing'] })),
  route('POST', '/api/v1/music/pause', 'command', command('pauseMusic')),
  route('POST', '/api/v1/music/next', 'command', command('musicNext')),
  route('POST', '/api/v1/music/previous', 'command', command('musicPrevious')),
  route('GET', '/api/v1/shastra', 'shastra.texts'),
  route('POST', '/api/v1/shastra', 'shastra', (b) => ({ reference: b['reference'] })),
  // Next with the revision it saw, when it says (Sessions 31–36, TST-11): nothing when the show has moved since;
  // with the run that revision is from, nothing in another run either (Session 53: Drashti restarted since).
  route('POST', '/api/v1/trigger/next', 'command', (b) => ({
    type: 'next',
    ...(b['rev'] !== undefined ? { rev: b['rev'] } : {}),
    ...(b['session'] !== undefined ? { session: b['session'] } : {}),
  })),
  route('POST', '/api/v1/trigger/back', 'command', command('back')),
  route('POST', '/api/v1/trigger/previous', 'command', command('previous')),
  route('POST', '/api/v1/trigger/next-item', 'command', command('nextItem')),
  route('POST', '/api/v1/trigger/previous-item', 'command', command('previousItem')),
  route('POST', '/api/v1/trigger/slide', 'command', (b) => ({ ...b, type: 'goLive' })),
  route('POST', '/api/v1/trigger/item', 'command', (b) => ({ ...b, type: 'playItem' })),
  route('POST', '/api/v1/clear/all', 'command', command('clearAll')),
  route('POST', '/api/v1/clear/:id', 'command', (_b, p) => ({ type: 'clearLayer', layer: p['id'] })),
  route('POST', '/api/v1/put-back', 'command', command('putBack')),
  // The live zoom from a phone (Session 54, D2): the zoom of the picture it looks at, and Back to Whole.
  route('POST', '/api/v1/zoom', 'command', (b) => ({
    type: 'zoomLive',
    zoom: b['zoom'],
    x: b['x'],
    y: b['y'],
  })),
  route('POST', '/api/v1/zoom/whole', 'command', command('resetLiveZoom')),
  // Repeat Slides (Session 26d): a Repeat Slides playlist going round (from a slide of it, if given), and Stop.
  route('POST', '/api/v1/repeat/stop', 'command', command('stopRepeat')),
  route('POST', '/api/v1/repeat/:id/start', 'command', (b, p) => ({
    ...b,
    type: 'startRepeat',
    playlistId: p['id'],
  })),
  route('POST', '/api/v1/blackout', 'command', (b) =>
    typeof b['on'] === 'boolean' ? { type: 'setBlackout', on: b['on'] } : { type: 'toggleBlackout' },
  ),
  route('POST', '/api/v1/logo', 'logo.set', (b) => ({ on: b['on'] })),
  route('POST', '/api/v1/timers/:id/start', 'command', (_b, p) => ({ type: 'startTimer', timerId: p['id'] })),
  route('POST', '/api/v1/timers/:id/pause', 'command', (_b, p) => ({ type: 'pauseTimer', timerId: p['id'] })),
  route('POST', '/api/v1/timers/:id/reset', 'command', (_b, p) => ({ type: 'resetTimer', timerId: p['id'] })),
  route('POST', '/api/v1/messages/:id/show', 'message.show', (b, p) => ({
    templateId: p['id'],
    values: b['values'],
  })),
  route('POST', '/api/v1/messages/:id/hide', 'message.hide', (_b, p) => ({ templateId: p['id'] })),
  // The phone as a mirror of the operator window (Session 54, D5).
  ...mirrorRoutes(route),
  route('POST', '/api/v1/announcements', 'announce', (b) => b),
  route('GET', '/api/v1/announcements/:id', 'announcement', (_b, p) => ({ id: p['id'] })),
  // Session 54: playlists shared with phones, and files a phone adds (upload-routes.ts).
  ...UPLOAD_ROUTES.map((r) => route(r.method, r.path, r.op, r.args, r.param)),
];

/** Every request the API takes, as "METHOD /path" (docs/api.md documents each; a test checks). */
export const API_ROUTES: readonly string[] = [
  'POST /api/v1/pair',
  ...ROUTES.map((r) => `${r.method} /${r.parts.join('/')}`),
];

type RouteMatch =
  | { found: true; route: Route; params: Record<string, string> }
  /** The path is known but takes another method. */
  | { found: false; method: true }
  | { found: false; method: false };

function matchRoute(method: string, parts: readonly string[]): RouteMatch {
  let otherMethod = false;
  for (const r of ROUTES) {
    if (r.parts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const fits = r.parts.every((p, i) => {
      const actual = parts[i] ?? '';
      if (p.startsWith(':')) {
        if (!(r.param ?? ID).test(actual)) return false;
        params[p.slice(1)] = actual;
        return true;
      }
      return p === actual;
    });
    if (!fits) continue;
    if (r.method !== method) {
      otherMethod = true;
      continue;
    }
    return { found: true, route: r, params };
  }
  return { found: false, method: otherMethod };
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const type = req.headers['content-type'] ?? '';
    const declared = Number(req.headers['content-length'] ?? '0');
    if (declared > MAX_BODY) {
      // Answer at once; what the device is still sending is read and dropped (the server's request
      // timeout bounds it), so the answer reaches it instead of a reset connection.
      req.resume();
      reject(new HttpError(413, 'That request is too large.'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'That request is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size === 0) {
        resolve({});
        return;
      }
      if (!type.toLowerCase().includes('application/json')) {
        reject(new HttpError(415, 'Send JSON (Content-Type: application/json).'));
        return;
      }
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof value !== 'object' || value === null || Array.isArray(value))
          throw new Error('not an object');
        resolve(value as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, 'That is not a JSON object.'));
      }
    });
    req.on('error', () => {
      reject(new HttpError(400, 'The request was cut short.'));
    });
  });
}

export class NetworkServer {
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private options: ServerOptions | null = null;
  private files = new Map<string, WebFile>();
  private devices = new Map<string, DeviceAuth>();
  private readonly clients = new Set<Client>();
  private readonly mirror = new EngineMirror();
  private allowed: { names: Set<string>; at: number } | null = null;
  private readonly perDevice = new RateLimiter(20, 40);
  private readonly perAddress = new RateLimiter(50, 200);
  private readonly feedMessages = new RateLimiter(10, 30);
  private readonly wrongCodes = new WrongCodeLimiter();
  private previews: PreviewMaker | null = null;
  private uploads: Uploads | null = null;
  /** The last word on files from phones, kept for the uploads a start makes. */
  private uploadPolicy: UploadPolicy | null = null;
  /** A file's pieces, apart from every other request, so sending one never holds up Next. */
  private readonly pieces = new RateLimiter(10, 20);
  private media: MediaServing | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private lastConnected = '';
  /**
   * Whether Drashti is let in (Session 54, access by Gmail), as the main process says: until it says so, and once it
   * has stopped, every request is refused here, those this process answers itself (a picture, an original, a link,
   * an upload) as much as those it asks the main process.
   */
  private letIn = false;

  constructor(private readonly host: ServerHost) {}

  setLetIn(letIn: boolean): void {
    this.letIn = letIn;
  }

  get listening(): boolean {
    return this.server?.listening ?? false;
  }

  start(options: ServerOptions): Promise<StartResult> {
    this.options = options;
    this.files = listWebFiles(options.webDir);
    this.previews = new PreviewMaker(options.previewDir, options.ffmpeg);
    this.uploads = uploadsAt(options.uploads, this.host);
    if (this.uploadPolicy) this.uploads?.setPolicy(this.uploadPolicy);
    this.media = new MediaServing(options.previewDir, options.ffmpeg, (id) => this.host.mediaSource(id), {
      sound: (id) => this.host.sharedSound?.(id) ?? Promise.resolve(null),
    });
    const server = createServer((req, res) => {
      this.onRequest(req, res);
    });
    server.headersTimeout = 10_000;
    server.requestTimeout = 30_000;
    server.keepAliveTimeout = 5000;
    server.maxHeadersCount = 50;
    const limits = options.sockets ?? SOCKET_LIMITS;
    server.maxConnections = limits.total;
    const fromAddress = new Map<string, number>();
    server.on('connection', (socket) => {
      const address = socket.remoteAddress ?? '';
      const count = (fromAddress.get(address) ?? 0) + 1;
      if (count > limits.perAddress) {
        socket.destroy();
        return;
      }
      fromAddress.set(address, count);
      socket.once('close', () => {
        const left = (fromAddress.get(address) ?? 1) - 1;
        if (left > 0) fromAddress.set(address, left);
        else fromAddress.delete(address);
      });
    });
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FEED_MESSAGE, clientTracking: false });
    server.on('upgrade', (req, socket, head) => {
      this.onUpgrade(req, socket, head);
    });
    return new Promise((resolve) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        const message =
          error.code === 'EADDRINUSE'
            ? `Port ${options.port} is in use by another program on this computer. Choose another port for Drashti, or close that program.`
            : error.code === 'EACCES'
              ? `This computer does not let Drashti use port ${options.port}. Choose another port.`
              : `Drashti could not listen on port ${options.port}: choose another port, or restart the computer.`;
        this.host.log('warn', `The phone server did not start (${error.code ?? 'no code'})`);
        resolve({ ok: false, message });
      });
      server.listen(options.port, options.bind, () => {
        this.server = server;
        this.wss = wss;
        this.heartbeat = setInterval(() => {
          this.beat();
        }, HEARTBEAT_MS);
        const address = server.address();
        resolve({ ok: true, port: typeof address === 'object' && address ? address.port : options.port });
      });
    });
  }

  /** Close every connection (telling each device why) and stop listening. */
  stop(reason: ByeReason = 'network-off'): Promise<void> {
    void this.uploads?.stop();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const c of this.clients) this.bye(c, reason);
    const server = this.server;
    this.server = null;
    this.wss = null;
    this.updateConnected();
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
      server.closeAllConnections();
    });
  }

  /** The paired devices (replacing the list): one no longer there is cut off at once. */
  setDevices(list: readonly DeviceAuth[]): void {
    this.devices = new Map(list.map((d) => [d.tokenHash, d]));
    const ids = new Map(list.map((d) => [d.id, d]));
    this.uploads?.keepDevices(new Set(ids.keys()));
    for (const c of this.clients) {
      if (!c.device) continue;
      const now = ids.get(c.device.id);
      if (!now) this.bye(c, 'revoked');
      else c.device = now;
    }
  }

  /** A device paired just now: known before its first request arrives. */
  addDevice(device: DeviceAuth): void {
    this.devices.set(device.tokenHash, device);
  }

  /** Whether phones may add files now, how large, and whether the stream is on air (Session 54). */
  setUploadPolicy(policy: UploadPolicy): void {
    this.uploadPolicy = policy;
    this.uploads?.setPolicy(policy);
  }

  /** What the main process made of a file a phone added, and what the phone reads while it waits. */
  uploadOutcome(id: string, outcome: ArrivedOutcome): void {
    this.uploads?.outcome(id, outcome);
  }

  uploadNote(id: string, message: string): void {
    this.uploads?.note(id, message);
  }

  /** A message from the engine: kept, and sent on to every device on the feed. */
  engine(message: EngineMessage): void {
    const result = this.mirror.apply(message);
    if (result === 'resync') {
      this.host.resync();
      return;
    }
    if (result !== 'applied') return;
    const text = JSON.stringify({ type: 'engine', message } satisfies ToDevice);
    for (const c of this.clients) if (c.device) this.sendText(c, text);
  }

  /**
   * Lists a remote shows have changed; a stage display hears of the screens
   * changing too (which group is the stage's).
   */
  hint(what: NetworkChange): void {
    const text = JSON.stringify({ type: 'changed', what } satisfies ToDevice);
    for (const c of this.clients)
      if (c.device?.kind === 'remote' || (c.device?.kind === 'stage' && what === 'screens'))
        this.sendText(c, text);
  }

  // ---- checks every request passes -------------------------------------------------------

  private addressAllowed(address: string): boolean {
    if (this.options?.refuseLoopback && isLoopback(address)) return false;
    return isLocalAddress(address);
  }

  private allowedNames(): Set<string> {
    const now = Date.now();
    if (!this.allowed || now - this.allowed.at > 5000)
      this.allowed = {
        names: allowedHostNames(localInterfaceAddresses(), this.options?.localName ?? null),
        at: now,
      };
    return this.allowed.names;
  }

  private port(): number {
    const address = this.server?.address();
    return typeof address === 'object' && address ? address.port : (this.options?.port ?? 0);
  }

  /** Why a request is refused before anything else, or null when it may go on. */
  private gate(req: IncomingMessage): { status: number; message: string } | null {
    const address = req.socket.remoteAddress ?? '';
    if (!this.addressAllowed(address))
      return { status: 403, message: 'Only devices on this local network can reach Drashti.' };
    if (!hostAllowed(req.headers.host, this.port(), this.allowedNames()))
      return { status: 421, message: 'Open Drashti by this computer’s own address.' };
    if (!originAllowed(req.headers.origin, req.headers.host))
      return { status: 403, message: 'Requests from other web pages are refused.' };
    return null;
  }

  // ---- HTTP -------------------------------------------------------------------------------

  private onRequest(req: IncomingMessage, res: ServerResponse): void {
    const refused = this.gate(req);
    if (refused) {
      this.json(res, refused.status, { ok: false, message: refused.message });
      return;
    }
    const address = req.socket.remoteAddress ?? '';
    // The API's paths are segments (an id may hold an encoded "/"); the pages' files are names only.
    if ((req.url ?? '').startsWith('/api/')) {
      const segments = apiSegments(req.url ?? '');
      if (!segments) {
        this.json(res, 400, { ok: false, message: 'Drashti does not serve that path.' });
        return;
      }
      void this.api(req, res, segments, address);
      return;
    }
    const path = safeRequestPath(req.url ?? '');
    if (!path) {
      this.json(res, 400, { ok: false, message: 'Drashti does not serve that path.' });
      return;
    }
    if (!this.perAddress.take(address)) {
      this.json(res, 429, { ok: false, message: 'Too many requests: wait a moment.' });
      return;
    }
    this.serveFile(req, res, path);
  }

  private serveFile(req: IncomingMessage, res: ServerResponse, path: string): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      this.json(res, 405, { ok: false, message: 'Only GET is served here.' });
      return;
    }
    const file = this.files.get(path);
    if (!file) {
      this.json(res, 404, { ok: false, message: 'There is no such page.' });
      return;
    }
    const headers: Record<string, string | number> = {
      ...SECURITY_HEADERS,
      'Content-Type': file.type,
      'Content-Length': file.bytes,
      'Cache-Control': file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    if (file.type.startsWith('text/html')) {
      const host = req.headers.host ?? '';
      headers['Content-Security-Policy'] =
        `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; ` +
        `font-src 'self' data:; connect-src 'self' ws://${host}; object-src 'none'; base-uri 'none'; ` +
        `form-action 'none'; frame-ancestors 'none'`;
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(file.file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  private authenticate(req: IncomingMessage): DeviceAuth | null {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/u.exec(header.trim());
    if (!match?.[1]) return null;
    return this.devices.get(hashToken(match[1])) ?? null;
  }

  private async api(
    req: IncomingMessage,
    res: ServerResponse,
    segments: readonly string[],
    address: string,
  ): Promise<void> {
    try {
      if (!this.letIn) throw new HttpError(503, STOPPED_REFUSAL);
      if (segments.join('/') === 'api/v1/pair') {
        if (req.method !== 'POST') throw new HttpError(405, 'Pair with POST.');
        await this.pair(req, res, address);
        return;
      }
      const device = this.authenticate(req) ?? this.linked(req, segments);
      if (!device) {
        if (!this.perAddress.take(address)) throw new HttpError(429, 'Too many requests: wait a moment.');
        res.setHeader('WWW-Authenticate', 'Bearer');
        throw new HttpError(
          401,
          'This device is not paired with Drashti. Pair it again from Phones and tablets in Drashti.',
        );
      }
      // A file's pieces count apart (Session 54): a phone sending one can still tap Next.
      const limit = isPiece(req.method, segments) ? this.pieces : this.perDevice;
      if (!limit.take(device.id)) throw new HttpError(429, 'Too many requests: slow down a little.');
      this.host.seen(device.id);
      const found = matchRoute(req.method ?? 'GET', segments);
      if (!found.found)
        throw found.method
          ? new HttpError(405, 'That request takes another method.')
          : new HttpError(404, 'There is no such request.');
      const { route: r, params } = found;
      if (!deviceMay(device.kind, r.op))
        throw new HttpError(403, `A ${DEVICE_KIND_LABEL[device.kind]} device cannot do this.`);
      if (r.op === 'me') {
        this.json(res, 200, { ok: true, device: { name: device.name, kind: device.kind } });
        return;
      }
      if (r.op === 'state') {
        // With the run its revision is from (Session 53), as the feed's snapshot says it.
        this.json(res, 200, {
          ok: true,
          rev: this.mirror.rev,
          session: this.mirror.session,
          state: this.mirror.state,
        });
        return;
      }
      if (r.op === 'preview') {
        await this.preview(res, params['id'] ?? '');
        return;
      }
      // Files a phone adds (Session 54): taken here, in the network's own process.
      const upload = await uploadAnswer(this.uploads, r.op, req, device, params, () => readJson(req));
      if (upload) {
        this.json(res, upload.status, upload.body);
        return;
      }
      if (r.op === 'media.picture' || r.op === 'media.original') {
        await this.fullQuality(req, res, segments, params['id'] ?? '', device);
        return;
      }
      // A POST's JSON body, or a GET's query (strings only).
      const body = req.method === 'POST' ? await readJson(req) : apiQuery(req.url ?? '');
      const args = r.args ? r.args(body, params) : {};
      const answer = await this.host.request({ deviceId: device.id, op: r.op, args, address });
      this.json(res, answer.status, answer.body);
    } catch (error) {
      if (error instanceof HttpError) this.json(res, error.status, { ok: false, message: error.message });
      else {
        this.host.log('warn', `A network request failed: ${(error as Error).message}`);
        this.json(res, 500, { ok: false, message: COULD_NOT });
      }
    }
  }

  private async pair(req: IncomingMessage, res: ServerResponse, address: string): Promise<void> {
    if (!this.wrongCodes.allowed(address))
      throw new HttpError(429, 'Too many wrong codes. Wait a minute, then ask the operator for a new code.');
    const body = await readJson(req);
    const code = typeof body['code'] === 'string' ? body['code'].replace(/\s+/gu, '') : '';
    if (!/^\d{4,10}$/u.test(code)) {
      this.wrongCodes.failed(address);
      throw new HttpError(400, 'Type the code Drashti shows.');
    }
    const answer = await this.host.pair(code, address);
    if (!answer.ok) {
      if (answer.status === 403) this.wrongCodes.failed(address);
      throw new HttpError(answer.status, answer.message);
    }
    this.addDevice(answer.device);
    this.json(res, 200, {
      ok: true,
      token: answer.token,
      device: { name: answer.device.name, kind: answer.device.kind },
    });
  }

  private async preview(res: ServerResponse, mediaId: string): Promise<void> {
    if (!MEDIA_ID_PATTERN.test(mediaId)) throw new HttpError(404, 'There is no such media item.');
    const source = await this.host.mediaSource(mediaId);
    if (!source) throw new HttpError(404, 'There is no such media item.');
    const file = await this.previews?.get(mediaId, source);
    if (!file) throw new HttpError(503, 'No preview of that item yet.');
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
    });
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  /**
   * A <video>'s request for a file's original (Session 54, D1), which cannot carry the token: the device its link
   * was made for, while that device is paired and the link is for this file and still works.
   */
  private linked(req: IncomingMessage, segments: readonly string[]): DeviceAuth | null {
    if (segments.length !== 5 || segments[4] !== 'original' || req.headers.authorization !== undefined)
      return null;
    const ticket = apiQuery(req.url ?? '')['link'];
    const deviceId = ticket && this.media ? this.media.links.check(ticket, segments[3] ?? '') : null;
    return deviceId ? ([...this.devices.values()].find((d) => d.id === deviceId) ?? null) : null;
  }

  /** Full quality (Session 54, D1): a picture at a width, a file's original in pieces, or a link to it. */
  private async fullQuality(
    req: IncomingMessage,
    res: ServerResponse,
    segments: readonly string[],
    mediaId: string,
    device: DeviceAuth,
  ): Promise<void> {
    const media = this.media;
    if (!media || !MEDIA_ID_PATTERN.test(mediaId)) throw new HttpError(404, 'There is no such media item.');
    const what = segments[4];
    if (what === 'link') {
      if (!(await media.original(mediaId))) throw new HttpError(404, 'There is no such media item.');
      const { ticket, until } = media.links.make(device.id, mediaId);
      this.json(res, 200, {
        ok: true,
        url: `/api/v1/media/${encodeURIComponent(mediaId)}/original?link=${ticket}`,
        until: new Date(until).toISOString(),
      });
      return;
    }
    if (what === 'picture') {
      const picture = await media.picture(mediaId, apiQuery(req.url ?? '')['width']);
      if (picture === 'none') throw new HttpError(404, 'There is no such media item.');
      const sent =
        picture !== null &&
        (await sendFile(
          req,
          res,
          // A step made smaller is named by its file (the picture's version and step); the original by its own.
          {
            path: picture.file,
            type: picture.type,
            ...(picture.original ? {} : { tag: basename(picture.file) }),
          },
          SECURITY_HEADERS,
        ));
      if (!sent) throw new HttpError(503, 'That picture is not ready yet: try again in a moment.');
      return;
    }
    const original = await media.original(mediaId);
    if (!original || !(await sendFile(req, res, original, SECURITY_HEADERS)))
      throw new HttpError(404, 'There is no such media item.');
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    const text = JSON.stringify(body);
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      'Cache-Control': 'no-store',
      // A request refused for its size is not read to the end: this connection is done.
      ...(status === 413 ? { Connection: 'close' } : {}),
    });
    res.end(text);
  }

  // ---- the feed (WebSocket) -------------------------------------------------------------

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const refuse = (status: number, text: string) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    socket.on('error', () => socket.destroy());
    const refused = this.gate(req);
    if (refused) {
      refuse(refused.status, refused.status === 421 ? 'Misdirected Request' : 'Forbidden');
      return;
    }
    if (safeRequestPath(req.url ?? '') !== FEED_PATH) {
      refuse(404, 'Not Found');
      return;
    }
    const address = req.socket.remoteAddress ?? '';
    const fromHere = [...this.clients].filter((c) => c.address === address).length;
    if (!this.wss || this.clients.size >= MAX_CLIENTS || fromHere >= MAX_CLIENTS_PER_ADDRESS) {
      refuse(503, 'Service Unavailable');
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.onConnection(ws, address);
    });
  }

  private onConnection(ws: WebSocket, address: string): void {
    const client: Client = { id: randomUUID(), ws, address, device: null, alive: true };
    this.clients.add(client);
    const hello = setTimeout(() => {
      if (!client.device) this.bye(client, 'unauthorized');
    }, HELLO_WITHIN_MS);
    ws.on('message', (data, isBinary) => {
      if (isBinary || !this.feedMessages.take(client.id)) {
        ws.terminate();
        return;
      }
      let message: FromDevice;
      try {
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(data);
        message = JSON.parse(bytes.toString('utf8')) as FromDevice;
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
      this.updateConnected();
    });
    ws.on('error', () => {
      ws.terminate();
    });
  }

  private onFeedMessage(client: Client, message: FromDevice, hello: NodeJS.Timeout): void {
    if (!client.device) {
      if (message.type !== 'hello' || typeof message.token !== 'string' || message.token.length > 200) {
        this.bye(client, 'unauthorized');
        return;
      }
      const device = this.devices.get(hashToken(message.token));
      if (!device) {
        this.bye(client, 'unauthorized');
        return;
      }
      if (device.kind !== 'remote' && device.kind !== 'stage') {
        this.bye(client, 'not-allowed');
        return;
      }
      clearTimeout(hello);
      client.device = device;
      this.send(client, { type: 'welcome', device: { name: device.name, kind: device.kind } });
      this.sendSnapshot(client);
      this.host.seen(device.id);
      this.updateConnected();
      return;
    }
    if (message.type === 'clock' && typeof message.t0 === 'number' && Number.isFinite(message.t0)) {
      this.send(client, { type: 'clock', t0: message.t0, server: Date.now() });
      return;
    }
    if (message.type === 'resync') this.sendSnapshot(client);
  }

  private sendSnapshot(client: Client): void {
    const state = this.mirror.state;
    if (!state) return;
    this.send(client, {
      type: 'engine',
      message: {
        kind: 'snapshot',
        version: ENGINE_STATE_VERSION,
        rev: this.mirror.rev,
        state,
        sentAt: Date.now(),
        // The run it is from (Session 53), as the engine's own pages and a node's link have it: a page left open
        // while Drashti restarted takes the new run's state at once, though its revisions started again from 0.
        session: this.mirror.session,
      },
    });
  }

  private send(client: Client, message: ToDevice): void {
    this.sendText(client, JSON.stringify(message));
  }

  /** Send, unless the device has fallen too far behind (a phone on slow Wi-Fi): then it reconnects. */
  private sendText(client: Client, text: string): void {
    if (client.ws.readyState !== client.ws.OPEN) return;
    if (client.ws.bufferedAmount > MAX_BUFFERED) {
      this.bye(client, 'too-slow');
      return;
    }
    client.ws.send(text);
  }

  private bye(client: Client, reason: ByeReason): void {
    try {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(JSON.stringify({ type: 'bye', reason } satisfies ToDevice));
        client.ws.close(4000, reason);
      }
    } catch {
      // Closing anyway.
    }
    setTimeout(() => {
      client.ws.terminate();
    }, 1000).unref();
    if (client.device) {
      client.device = null;
      this.updateConnected();
    }
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

  private updateConnected(): void {
    const ids = [...new Set([...this.clients].flatMap((c) => (c.device ? [c.device.id] : [])))].sort();
    const key = ids.join(',');
    if (key === this.lastConnected) return;
    this.lastConnected = key;
    this.host.connected(ids);
  }
}
