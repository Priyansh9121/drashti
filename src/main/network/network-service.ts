import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { type CommandResult, type EngineCommand, parseEngineCommand } from '../../shared/engine/commands';
import type { EngineMessage, EngineSnapshotMessage } from '../../shared/engine/protocol';
import type { EngineState, PropItem } from '../../shared/engine/state';
import type { EngineTransport } from '../../shared/engine/transport';
import { IPC, type InvokeChannel } from '../../shared/ipc';
import type { PresentationDoc } from '../../shared/library';
import type { Lang } from '../../shared/model';
import { fillMessage, type MessageTemplate, messageItemId } from '../../shared/messages';
import { STOPPED_REFUSAL } from '../../shared/access';
import { SIMPLE_MODE_REFUSAL } from '../../shared/mode';
import { idSchema } from '../../shared/model-schema';
import {
  DEFAULT_NETWORK_PORT,
  DEVICE_KIND_LABEL,
  DEVICE_KINDS,
  DEVICE_NAME_MAX,
  type DeviceInfo,
  type DeviceKind,
  MAX_NETWORK_PORT,
  MIN_NETWORK_PORT,
  type NetworkChange,
  type NetworkResult,
  type NetworkStatus,
  PAIRING_CODE_TTL_MS,
} from '../../shared/network';
import {
  type DeviceAnswer,
  type DeviceAuth,
  type DeviceOp,
  type DeviceRequest,
  deviceMay,
  isDeviceOp,
  type PairAnswer,
  REMOTE_COMMANDS,
  REMOTE_LIBRARY_MAX,
  REMOTE_LIBRARY_PAGE,
  type RemoteLibraryPage,
  type RemotePresentation,
} from '../../shared/network-api';
import type { PlaylistItemInfo, PlaylistNode } from '../../shared/playlists';
import type {
  AddFilesView,
  ArrivedFile,
  ArrivedOutcome,
  SharedPlaylist,
  UploadPolicy,
} from '../../shared/phone-files';
import type { ScreenSwitches } from '../../shared/screen-switches';
import type { SearchResult } from '../../shared/search';
import type { PassageResult } from '../../shared/shastra';
import { referenceInputSchema } from '../../shared/shastra';
import { type HallGroup, hallPicture } from '../../shared/stage-layouts';
import type { DeviceRepo, DeviceRow } from '../db/devices';
import { localInterfaceAddresses } from './addresses';
import type { NetworkWorker } from './network-worker';
import type { PreviewSource } from './previews';
import type { ServerOptions } from './server';
import { hashToken, newPairingCode, newToken } from './tokens';
import type { FromNetworkWorker } from './worker/protocol';
import { COULD_NOT } from './messages';
import { mirrorAnswer, type MirrorReads } from './mirror-answers';
import { type DesktopActs, DesktopAnswers } from './desktop-answers';
import { cutText } from '../../shared/text';
import { NO_LOGO_CHOSEN } from '../../shared/props';
import { nfcDeep } from '../../shared/nfc';

/*
 * The local network, as the main process runs it (README "The local
 * network"). It keeps the settings (on or off, the port), the paired
 * devices and the pairing code; starts and stops the network worker, which
 * serves the devices; hands the worker each engine message; and answers
 * what devices ask for, with the same checks the windows' requests get:
 * the device and its kind, the same schemas, and Simple Mode's refusals.
 * Everything a device does is logged with the device's name, never its
 * token or the pairing code.
 */

export interface NetworkReads {
  playlists(): PlaylistNode[];
  items(playlistId: string): PlaylistItemInfo[];
  presentation(presentationId: string): PresentationDoc | null;
  /** The library's presentations by name, `limit` of them from `offset`, and how many there are (Session 18). */
  library(offset: number, limit: number): { presentations: RemotePresentation[]; total: number };
  /** The library searched as the operator window searches it. */
  search(query: string): SearchResult;
  messages(): MessageTemplate[];
  /** The prop marked as the logo, ready for the engine; null when none is. */
  logo(): PropItem | null;
  /** A media item's file and kind for a preview (pictures and videos only). */
  mediaSource(mediaId: string): PreviewSource | null;
  /** A sound's file while a playlist shared with phones has it (Session 54, D3), for a phone to play; else null. */
  sharedSound(mediaId: string): string | null;
  /**
   * The stage display's group (the first stage group, or null when there is
   * none) and its languages in the live Look (null: all of them).
   */
  stage(): { groupId: string | null; languages: Lang[] | null };
  /**
   * The screen groups, with each screen's canvas, where it is and whether it is
   * on, as the hall's picture is read from them (Session 51: a stage display's
   * layout's audience picture box, as this computer's stage screens draw it).
   */
  hallGroups(): readonly HallGroup[];
  /** The hall's group (the first audience group, or null when there is none): a remote shows the slide as it does. */
  hall(): { groupId: string | null };
  /** Main's Audience and Stage (Session 50): a Remote says which are off, and cannot turn them. */
  switches(): ScreenSwitches;
  /** The Looks, in order (a Remote switches the live one). */
  looks(): { id: string; name: string }[];
  /** The loaded Shastra texts. */
  shastraTexts(): { name: string; abbreviation: string; itemCount: number }[];
  /** What a Shastra reference names (a passage that plays like a presentation), or why it names nothing. */
  passage(reference: string): PassageResult;
  /** How this computer writes the time (its locale and time zone), so a stage display's clock reads as the stage screens' does. */
  clockStyle(): { locale: string; timeZone: string };
}

export interface NetworkDeps {
  devices: DeviceRepo;
  /** How bookkeeping reaches the library: when it is free, never waiting (Session 15). Left out: at once. */
  write?: (key: string, run: () => void) => void;
  settings: { get(name: string): unknown; set(name: string, value: unknown): void };
  spawn(): NetworkWorker;
  /** How the server is set up for this port (where the pages are, FFmpeg, the address to listen on). */
  serverOptions(port: number): ServerOptions;
  localName(): string | null;
  engine: {
    dispatch(command: EngineCommand): CommandResult;
    snapshot(): EngineSnapshotMessage;
    state(): EngineState;
  };
  reads: NetworkReads;
  /** What a phone reads to mirror the operator window (Session 54, D5: mirror-answers.ts). */
  mirror: MirrorReads;
  /**
   * Play the audio playlist (music-service.ts): the one a phone chose (Session 54, D5), or on from a pause, or the
   * one played last.
   */
  playMusic(who: string, playlistId: string | null): { ok: true } | { ok: false; message: string };
  /** Announcements from phones (announcement-service.ts). */
  announcements: {
    submit(device: { id: string; name: string }, address: string, input: unknown): DeviceAnswer;
    statusFor(device: { id: string }, args: unknown): DeviceAnswer;
  };
  /**
   * The computer's own things a phone sets up (Session 54, the phone as a full Drashti: desktop-answers.ts), as the
   * window's own requests do them. Left out (a test of something else): a phone cannot.
   */
  desktop?: DesktopActs;
  /** Files between Drashti and its phones (Session 54, phone-files.ts): shared playlists, and files phones add. */
  files?: {
    view(): AddFilesView;
    setOn(on: boolean): void;
    policy(): UploadPolicy;
    shared(): SharedPlaylist[];
    sharedItems(playlistId: string): PlaylistItemInfo[] | null;
    /** `note`: what the phone reads meanwhile (a deck waiting for the stream to end). */
    arrived(file: ArrivedFile, note: (message: string) => void): Promise<ArrivedOutcome>;
  };
  /** Whether Simple Mode refuses this window channel now (the same table the windows' requests go through). */
  refused(channel: InvokeChannel): boolean;
  /** The status changed: the operator window is told. */
  changed(status: NetworkStatus): void;
  log(level: 'info' | 'warn', message: string): void;
  now(): number;
  /**
   * Whether Drashti is let in (Session 54, access by Gmail): while it is not, every device's request, every pairing
   * and every file is refused, here and in the worker. Left out (a test): let in.
   */
  letIn?: () => boolean;
}

/**
 * The window's request that does what each op does: a device gets what the
 * operator window would get, Simple Mode included. Null for what only the
 * network does (who am I, previews, announcements), which Simple Mode does
 * not touch.
 */
export const OP_CHANNEL: Record<DeviceOp, InvokeChannel | null> = {
  me: null,
  status: IPC.engine.snapshot,
  state: IPC.engine.snapshot,
  stage: IPC.screens.get,
  hall: IPC.screens.get,
  looks: IPC.looks.list,
  // Playing music is not a change to the library: Simple Mode lets a Remote do it, as it does the window.
  'music.play': IPC.music.play,
  'shastra.texts': IPC.shastra.list,
  // Putting up a passage runs the show, as Next does: Simple Mode lets a Remote do it.
  shastra: IPC.engine.command,
  playlists: IPC.playlists.tree,
  items: IPC.playlists.items,
  presentation: IPC.library.getPresentation,
  // The presenter's remote (Session 18) reads the library as the window does: Simple Mode keeps reading.
  presentations: IPC.library.listPresentations,
  search: IPC.library.search,
  messages: IPC.messages.list,
  timers: IPC.engine.snapshot,
  logo: IPC.props.getLogo,
  command: IPC.engine.command,
  'logo.set': IPC.engine.command,
  'message.show': IPC.engine.command,
  'message.hide': IPC.engine.command,
  preview: null,
  // Full quality (Session 54, D1): looking, as a preview is.
  'media.picture': null,
  'media.original': null,
  announce: null,
  announcement: null,
  // The mirror (Session 54, D5): the window's own reads, and what goes up as the window puts it up.
  keys: IPC.app.singleKeys,
  props: IPC.props.list,
  'prop.show': IPC.engine.command,
  media: IPC.library.listMedia,
  'media.show': IPC.engine.command,
  lowerThirds: IPC.lowerThirds.list,
  'lowerThird.show': IPC.engine.command,
  music: IPC.music.view,
  'repeat.start': IPC.engine.command,
  // Session 54: a shared playlist is read as a playlist is (Simple Mode reads too). Files a phone adds carry on in
  // Simple Mode while the switch is on, as the drop folder's do.
  shared: IPC.playlists.items,
  'shared.items': IPC.playlists.items,
  uploads: null,
  upload: null,
  'upload.status': null,
  'upload.piece': null,
  'upload.cancel': null,
  // The phone as a full Drashti (Session 54): each the window's own request, so Simple Mode refuses on a phone just
  // what it refuses in the window (the screens' changes; Keep and Go back, Identify and the switches stay open, and
  // the switch service itself turns them only on in Simple Mode).
  screens: IPC.screens.get,
  'screens.addGroup': IPC.screens.createGroup,
  'screens.renameGroup': IPC.screens.renameGroup,
  'screens.groupRole': IPC.screens.setGroupRole,
  'screens.deleteGroup': IPC.screens.deleteGroup,
  'screens.useDisplay': IPC.screens.assignDisplay,
  'screens.change': IPC.screens.updateScreen,
  'screens.remove': IPC.screens.removeScreen,
  'screens.keep': IPC.screens.keep,
  'screens.goBack': IPC.screens.goBack,
  'screens.identify': IPC.screens.identify,
  switch: IPC.screenSwitches.turn,
  // Media's video inputs and Show a Window… (Session 54), Pro Mode's as in the window.
  inputs: IPC.videoInputs.list,
  'input.add': IPC.videoInputs.add,
  'input.change': IPC.videoInputs.update,
  'input.remove': IPC.videoInputs.remove,
  windows: IPC.liveWindow.list,
  'window.show': IPC.liveWindow.show,
};

const ON_SETTING = 'network.on';
const PORT_SETTING = 'network.port';
/** A pairing code is dropped after this many wrong tries, whoever made them. */
const WRONG_TRIES = 10;
/** How often last-seen times are written to the library (never on each request). */
const SEEN_WRITE_MS = 10 * 60 * 1000;

const portSchema = z.number().int().min(MIN_NETWORK_PORT).max(MAX_NETWORK_PORT);
const nameSchema = z.string().trim().min(1).max(DEVICE_NAME_MAX);
const kindSchema = z.enum(DEVICE_KINDS);
const showSchema = z
  .object({
    templateId: idSchema,
    values: z.record(z.string().max(60), z.string().max(200)).optional(),
  })
  .strict();
const hideSchema = z.object({ templateId: idSchema }).strict();
const logoSchema = z.object({ on: z.boolean().optional() }).strict();

const ok = (body: Record<string, unknown> = {}): DeviceAnswer => ({
  status: 200,
  body: { ok: true, ...body },
});
/** A whole number from a query string (or a number), within bounds; `fallback` when there is none. */
export function wholeNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const n =
    typeof raw === 'string' && /^\d{1,9}$/u.test(raw) ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

const deny = (status: number, message: string): DeviceAnswer => ({ status, body: { ok: false, message } });

const sameCode = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class NetworkService implements EngineTransport {
  private worker: NetworkWorker | null = null;
  private serverState: NetworkStatus['state'] = 'off';
  private message: string | null = null;
  private boundPort: number | null = null;
  private connected = new Set<string>();
  private readonly lastSeen = new Map<string, string>();
  private seenSaves = 0;
  private unsaved = new Map<string, string>();
  private pairing: { code: string; kind: DeviceKind; name: string; expiresAt: number; wrong: number } | null =
    null;
  private pairingTimer: NodeJS.Timeout | null = null;
  private poster: { url: string; madeAt: string } | null = null;
  private stopping: Promise<void> | null = null;
  private seenWriter: NodeJS.Timeout | null = null;
  private seenNotice: NodeJS.Timeout | null = null;
  /** The computer's own things a phone sets up (Session 54), or null where it cannot. */
  private readonly desktop: DesktopAnswers | null;

  constructor(private readonly deps: NetworkDeps) {
    this.desktop = deps.desktop
      ? new DesktopAnswers(deps.desktop, {
          // At the computer's yes, long after the ask: still let in, the phone still paired, Simple Mode not refusing.
          mayStill: (deviceId, op) => {
            const channel = OP_CHANNEL[op];
            return (
              this.letIn() &&
              this.deps.devices.get(deviceId) !== null &&
              !(channel !== null && this.deps.refused(channel))
            );
          },
          changed: () => {
            this.hint('setup');
          },
          log: (message) => {
            this.deps.log('info', message);
          },
          now: () => this.deps.now(),
        })
      : null;
  }

  // ---- settings ----------------------------------------------------------------------------

  get on(): boolean {
    return this.deps.settings.get(ON_SETTING) === true;
  }

  get port(): number {
    const parsed = portSchema.safeParse(this.deps.settings.get(PORT_SETTING));
    return parsed.success ? parsed.data : DEFAULT_NETWORK_PORT;
  }

  /** At start: listen again if the operator left it on. */
  resume(): void {
    if (this.on) this.startServer();
  }

  status(): NetworkStatus {
    const port = this.boundPort ?? this.port;
    const localName = this.deps.localName();
    const addresses = localInterfaceAddresses()
      .filter((a) => !a.includes(':'))
      .map((a) => `http://${a}:${port}`);
    const devices: DeviceInfo[] = this.deps.devices.list().map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      pairedAt: d.pairedAt,
      lastSeenAt: this.lastSeen.get(d.id) ?? d.lastSeenAt,
      connected: this.connected.has(d.id),
      poster: d.poster,
    }));
    const pairing =
      this.pairing && this.pairing.expiresAt > this.deps.now()
        ? {
            code: this.pairing.code,
            kind: this.pairing.kind,
            name: this.pairing.name,
            url: `${addresses[0] ?? `http://localhost:${port}`}/pair#c=${this.pairing.code}`,
            expiresAt: this.pairing.expiresAt,
          }
        : null;
    return {
      on: this.on,
      state: this.serverState,
      port,
      message: this.message,
      addresses,
      localName: localName ? `http://${localName}:${port}` : null,
      connected: devices.filter((d) => d.connected).length,
      devices,
      pairing,
      poster: this.poster,
      ...(this.deps.files ? { addFiles: this.deps.files.view() } : {}),
    };
  }

  private changed(): void {
    this.deps.changed(this.status());
  }

  setOn(raw: unknown): NetworkResult {
    if (typeof raw !== 'boolean') return { ok: false, message: 'On or off?' };
    if (raw === this.on && (raw ? this.worker !== null : this.worker === null))
      return { ok: true, status: this.status() };
    this.deps.settings.set(ON_SETTING, raw);
    this.deps.log('info', raw ? 'Network: turned on' : 'Network: turned off');
    if (raw) this.startServer();
    else void this.stopServer();
    this.changed();
    return { ok: true, status: this.status() };
  }

  /** "Phones and tablets may add files" (Session 54): every person's. Turned off, what is coming stops. */
  setAddFiles(raw: unknown): NetworkResult {
    if (typeof raw !== 'boolean' || !this.deps.files) return { ok: false, message: 'On or off?' };
    this.deps.files.setOn(raw);
    this.uploadsChanged();
    this.changed();
    return { ok: true, status: this.status() };
  }

  /** The switch, or the stream on or off air, changed: the worker is told, and the phones read it again. */
  uploadsChanged(): void {
    this.pushUploads();
    this.hint('files');
  }

  private letIn(): boolean {
    return this.deps.letIn?.() ?? true;
  }

  /** Drashti let in or stopped (Session 54): the worker hears at once, and an upload on its way stops with it. */
  accessChanged(): void {
    this.worker?.send({ type: 'access', letIn: this.letIn() });
    this.uploadsChanged();
  }

  private pushUploads(): void {
    if (this.deps.files) this.worker?.send({ type: 'uploads', policy: this.deps.files.policy() });
  }

  setPort(raw: unknown): NetworkResult {
    const parsed = portSchema.safeParse(raw);
    if (!parsed.success)
      return { ok: false, message: `Choose a port from ${MIN_NETWORK_PORT} to ${MAX_NETWORK_PORT}.` };
    if (parsed.data === this.port) return { ok: true, status: this.status() };
    this.deps.settings.set(PORT_SETTING, parsed.data);
    this.deps.log('info', `Network: port set to ${parsed.data}`);
    if (this.worker) {
      void this.stopServer().then(() => {
        if (this.on) this.startServer();
      });
    }
    this.changed();
    return { ok: true, status: this.status() };
  }

  // ---- the worker -------------------------------------------------------------------------

  private startServer(): void {
    if (this.worker) return;
    this.serverState = 'starting';
    this.message = null;
    const worker = this.deps.spawn();
    this.worker = worker;
    worker.onMessage((m) => {
      if (this.worker === worker) this.fromWorker(worker, m);
    });
    worker.onExit(() => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.boundPort = null;
      this.connected = new Set();
      this.serverState = this.on ? 'failed' : 'off';
      if (this.on) {
        this.message = 'Drashti’s network stopped unexpectedly; starting it again.';
        this.deps.log('warn', 'Network: the worker stopped; starting it again');
        setTimeout(() => {
          if (this.on && !this.worker) this.startServer();
        }, 1000);
      }
      this.changed();
    });
    // The paired devices and the show first: a device that reconnects the moment the server listens
    // (after a restart) is known, never refused as unpaired, and gets the show at once.
    this.pushDevices();
    this.pushUploads();
    worker.send({ type: 'access', letIn: this.letIn() });
    worker.send({ type: 'engine', message: this.deps.engine.snapshot() });
    worker.send({ type: 'start', options: this.deps.serverOptions(this.port) });
    this.seenWriter ??= setInterval(() => {
      this.saveSeen();
    }, SEEN_WRITE_MS);
    this.changed();
  }

  /** Tell every device the network is off, stop listening and stop the worker. */
  private stopServer(): Promise<void> {
    const worker = this.worker;
    if (!worker) return this.stopping ?? Promise.resolve();
    this.worker = null;
    this.saveSeen();
    this.stopping = new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        worker.kill();
        resolve();
      };
      const timer = setTimeout(done, 2000);
      worker.onMessage((m) => {
        if (m.type === 'stopped') done();
      });
      worker.send({ type: 'stop', reason: 'network-off' });
    }).finally(() => {
      this.stopping = null;
    });
    this.serverState = 'off';
    this.message = null;
    this.boundPort = null;
    this.connected = new Set();
    this.changed();
    return this.stopping;
  }

  private fromWorker(worker: NetworkWorker, m: FromNetworkWorker): void {
    switch (m.type) {
      case 'started':
        if (m.result.ok) {
          this.serverState = 'listening';
          this.boundPort = m.result.port;
          this.message = null;
          // Again, in case either changed while it started.
          this.pushDevices();
          this.pushUploads();
          worker.send({ type: 'engine', message: this.deps.engine.snapshot() });
          this.deps.log('info', `Network: listening on port ${m.result.port}`);
        } else {
          this.serverState = 'failed';
          this.message = m.result.message;
          this.deps.log('warn', `Network: could not start (${m.result.message})`);
          this.worker = null;
          worker.kill();
        }
        this.changed();
        return;
      case 'ask':
        void this.ask(worker, m.id, m.question);
        return;
      case 'connected': {
        const at = new Date(this.deps.now()).toISOString();
        for (const id of m.deviceIds) if (!this.connected.has(id)) this.noteSeen(id, at);
        for (const id of this.connected)
          if (!m.deviceIds.includes(id)) this.deps.log('info', `Network: ${this.label(id)} disconnected`);
        for (const id of m.deviceIds)
          if (!this.connected.has(id)) this.deps.log('info', `Network: ${this.label(id)} connected`);
        this.connected = new Set(m.deviceIds);
        this.changed();
        return;
      }
      case 'seen':
        this.noteSeen(m.deviceId, new Date(this.deps.now()).toISOString());
        return;
      case 'resync':
        worker.send({ type: 'engine', message: this.deps.engine.snapshot() });
        return;
      case 'log':
        this.deps.log(m.level, `Network: ${m.message}`);
        return;
      case 'arrived':
        void this.arrived(worker, m.file);
        return;
      case 'stopped':
        return;
    }
  }

  /** A file a phone added has all arrived (Session 54): imported, and what came of it told to the phone. */
  private async arrived(worker: NetworkWorker, file: ArrivedFile): Promise<void> {
    let outcome: ArrivedOutcome;
    try {
      outcome = this.deps.files
        ? await this.deps.files.arrived(file, (message) => {
            if (this.worker === worker) worker.send({ type: 'upload-note', id: file.id, message });
          })
        : { ok: false, message: 'Drashti cannot take files from phones here.' };
    } catch (error) {
      this.deps.log('warn', `Network: a file from a phone could not be added (${(error as Error).message})`);
      outcome = { ok: false, message: COULD_NOT };
    }
    if (this.worker === worker) worker.send({ type: 'upload-outcome', id: file.id, outcome });
  }

  private async ask(
    worker: NetworkWorker,
    id: number,
    question: Extract<FromNetworkWorker, { type: 'ask' }>['question'],
  ): Promise<void> {
    let answer: unknown;
    try {
      // The open windows take the computer a while to list (Session 54): checked alike, answered once listed.
      if (question.kind === 'request')
        answer =
          question.request.op === 'windows'
            ? await this.windows(question.request)
            : this.answer(question.request);
      else if (question.kind === 'pair') answer = this.pair(question.code, question.address);
      // No file while Drashti is not let in (Session 54): a preview, a picture, an original, a shared sound.
      else if (!this.letIn()) answer = null;
      else if (question.kind === 'sound') answer = this.deps.reads.sharedSound(question.mediaId);
      else answer = this.deps.reads.mediaSource(question.mediaId);
    } catch (error) {
      this.deps.log('warn', `Network: a request failed (${(error as Error).message})`);
      answer =
        question.kind === 'media' || question.kind === 'sound'
          ? null
          : question.kind === 'pair'
            ? { ok: false, status: 500, message: COULD_NOT }
            : deny(500, COULD_NOT);
    }
    await Promise.resolve();
    worker.send({ type: 'answer', id, answer });
  }

  private pushDevices(): void {
    const devices: DeviceAuth[] = this.deps.devices
      .list()
      .map((d) => ({ id: d.id, name: d.name, kind: d.kind, tokenHash: d.tokenHash }));
    this.worker?.send({ type: 'devices', devices });
  }

  private label(id: string): string {
    const d = this.deps.devices.get(id);
    return d ? `${DEVICE_KIND_LABEL[d.kind]} “${d.name}”` : 'a removed device';
  }

  private noteSeen(id: string, at: string): void {
    this.lastSeen.set(id, at);
    this.unsaved.set(id, at);
    // The operator window hears of it now and then, not on every tap.
    this.seenNotice ??= setTimeout(() => {
      this.seenNotice = null;
      this.changed();
    }, 5000);
  }

  private saveSeen(): void {
    if (this.unsaved.size === 0) return;
    const seen = this.unsaved;
    this.unsaved = new Map();
    const write = this.deps.write ?? ((_key: string, run: () => void) => run());
    // Each batch on its own (a later one never replaces one still waiting).
    write(`devices-seen:${String(++this.seenSaves)}`, () => {
      try {
        this.deps.devices.touch(seen);
      } catch (error) {
        this.deps.log(
          'warn',
          `Network: could not keep when devices were last seen (${(error as Error).message})`,
        );
      }
    });
  }

  // ---- engine messages and hints ------------------------------------------------------------

  broadcast(message: EngineMessage): void {
    if (this.worker && this.serverState === 'listening') this.worker.send({ type: 'engine', message });
  }

  /** Lists the remotes show have changed (playlists, presentations, templates...). */
  hint(what: NetworkChange): void {
    if (this.worker && this.serverState === 'listening') this.worker.send({ type: 'hint', what });
  }

  // ---- pairing and devices ------------------------------------------------------------------

  startPairing(rawKind: unknown, rawName: unknown): NetworkResult {
    const kind = kindSchema.safeParse(rawKind);
    if (!kind.success) return { ok: false, message: 'Choose what the device is for.' };
    const given =
      rawName === undefined || rawName === null || rawName === '' ? null : nameSchema.safeParse(rawName);
    if (given && !given.success)
      return { ok: false, message: `A name needs 1 to ${DEVICE_NAME_MAX} characters.` };
    const names = new Set(this.deps.devices.list().map((d) => d.name));
    let name = given?.data ?? '';
    for (let n = 1; name === ''; n++) {
      const candidate = `${DEVICE_KIND_LABEL[kind.data]} ${n}`;
      if (!names.has(candidate)) name = candidate;
    }
    this.pairing = {
      code: newPairingCode(),
      kind: kind.data,
      name,
      expiresAt: this.deps.now() + PAIRING_CODE_TTL_MS,
      wrong: 0,
    };
    if (this.pairingTimer) clearTimeout(this.pairingTimer);
    this.pairingTimer = setTimeout(() => {
      this.pairingTimer = null;
      this.changed();
    }, PAIRING_CODE_TTL_MS + 50);
    this.deps.log('info', `Network: offering to pair a ${DEVICE_KIND_LABEL[kind.data]} device`);
    this.changed();
    return { ok: true, status: this.status() };
  }

  cancelPairing(): NetworkResult {
    this.pairing = null;
    this.changed();
    return { ok: true, status: this.status() };
  }

  /** The device typed (or its QR code carried) this code: a new device, and its token, once. */
  pair(code: string, address: string): PairAnswer {
    if (!this.letIn()) return { ok: false, status: 503, message: STOPPED_REFUSAL };
    const offer = this.pairing;
    const wrong = {
      ok: false as const,
      status: 403,
      message: 'That code is wrong or has expired. Ask the operator for a new one.',
    };
    if (!offer || offer.expiresAt <= this.deps.now()) return wrong;
    if (!sameCode(code, offer.code)) {
      offer.wrong++;
      if (offer.wrong >= WRONG_TRIES) {
        this.pairing = null;
        this.deps.log('warn', 'Network: a pairing code was dropped after too many wrong tries');
        this.changed();
      }
      return wrong;
    }
    this.pairing = null;
    const token = newToken();
    const device: DeviceRow = this.deps.devices.add({
      name: offer.name,
      kind: offer.kind,
      tokenHash: hashToken(token),
    });
    this.deps.log(
      'info',
      `Network: paired ${DEVICE_KIND_LABEL[device.kind]} “${device.name}” from ${address}`,
    );
    this.noteSeen(device.id, new Date(this.deps.now()).toISOString());
    this.pushDevices();
    this.changed();
    return {
      ok: true,
      token,
      device: { id: device.id, name: device.name, kind: device.kind, tokenHash: device.tokenHash },
    };
  }

  renameDevice(rawId: unknown, rawName: unknown): NetworkResult {
    const id = idSchema.safeParse(rawId);
    const name = nameSchema.safeParse(rawName);
    if (!name.success) return { ok: false, message: `A name needs 1 to ${DEVICE_NAME_MAX} characters.` };
    if (!id.success || !this.deps.devices.rename(id.data, name.data))
      return { ok: false, message: 'That device is no longer paired.' };
    this.pushDevices();
    this.changed();
    return { ok: true, status: this.status() };
  }

  /** Remove a device: its token stops working, and its connection is cut at once. */
  revokeDevice(rawId: unknown): NetworkResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success) return { ok: false, message: 'That device is no longer paired.' };
    const label = this.label(id.data);
    const device = this.deps.devices.get(id.data);
    if (!device || !this.deps.devices.remove(id.data))
      return { ok: false, message: 'That device is no longer paired.' };
    if (device.poster) this.poster = null;
    this.lastSeen.delete(id.data);
    this.unsaved.delete(id.data);
    this.deps.log('info', `Network: removed ${label}`);
    this.pushDevices();
    this.changed();
    return { ok: true, status: this.status() };
  }

  /**
   * A new announcements poster link (the old one stops working). Its key is
   * in the link's #fragment, which browsers never send to a server; Drashti
   * keeps only its hash, so the link is shown now, while Drashti runs.
   */
  makePoster(): NetworkResult {
    this.deps.devices.removePosters();
    const token = newToken();
    this.deps.devices.add({
      name: 'Announcements poster',
      kind: 'announcements',
      tokenHash: hashToken(token),
      poster: true,
    });
    const status = this.status();
    const base = status.addresses[0] ?? status.localName ?? `http://localhost:${status.port}`;
    this.poster = { url: `${base}/announce#k=${token}`, madeAt: new Date(this.deps.now()).toISOString() };
    this.deps.log('info', 'Network: made a new announcements poster link');
    this.pushDevices();
    this.changed();
    return { ok: true, status: this.status() };
  }

  // ---- what devices ask for ------------------------------------------------------------------

  /** Every request's checks: Drashti let in, the device still paired, its kind, Simple Mode's lock. */
  private checked(
    request: DeviceRequest,
  ): { device: DeviceRow; args: Record<string, unknown>; who: string } | DeviceAnswer {
    if (!this.letIn()) return deny(503, STOPPED_REFUSAL);
    const device = this.deps.devices.get(request.deviceId);
    if (!device) return deny(401, 'This device was removed in Drashti. Pair it again.');
    if (!isDeviceOp(request.op) || !deviceMay(device.kind, request.op))
      return deny(403, `A ${DEVICE_KIND_LABEL[device.kind]} device cannot do this.`);
    const channel = OP_CHANNEL[request.op];
    if (channel && this.deps.refused(channel)) return deny(403, SIMPLE_MODE_REFUSAL);
    const args = (request.args ?? {}) as Record<string, unknown>;
    return { device, args, who: `${DEVICE_KIND_LABEL[device.kind]} “${device.name}”` };
  }

  /** The other apps' open windows for a phone (Session 54): checked as every request is, answered once listed. */
  async windows(request: DeviceRequest): Promise<DeviceAnswer> {
    const checked = this.checked(request);
    if ('status' in checked) return checked;
    if (request.op !== 'windows' || !this.desktop)
      return deny(404, 'Drashti cannot list windows for a phone here.');
    return this.desktop.windows(checked.device);
  }

  answer(request: DeviceRequest): DeviceAnswer {
    const checked = this.checked(request);
    if ('status' in checked) return checked;
    const { device, args, who } = checked;
    switch (request.op) {
      case 'status':
        return ok({ status: summary(this.deps.engine.state()) });
      case 'stage': {
        const stage = this.deps.reads.stage();
        return ok({
          languages: stage.languages,
          groupId: stage.groupId,
          clock: this.deps.reads.clockStyle(),
          // A layout's audience picture box (Session 51): the hall as this computer's stage screens draw it, said
          // off while this computer's Audience is off (the switch a Remote is told of).
          hall: hallPicture(this.deps.reads.hallGroups(), this.deps.reads.switches().audience),
        });
      }
      case 'hall':
        return ok({
          groupId: this.deps.reads.hall().groupId,
          clock: this.deps.reads.clockStyle(),
          switches: this.deps.reads.switches(),
          // The stage screens' group (Session 54): a Remote runs the timers of its layout in the live Look.
          stageGroupId: this.deps.reads.stage().groupId,
        });
      case 'looks':
        return ok({ looks: this.deps.reads.looks(), liveId: this.deps.engine.state().look.id });
      case 'shastra.texts':
        return ok({ texts: this.deps.reads.shastraTexts() });
      case 'shastra': {
        const reference = referenceInputSchema.safeParse(args['reference']);
        if (!reference.success) return deny(400, 'Send a reference, for example {"reference": "SD 14"}.');
        const found = this.deps.reads.passage(reference.data);
        if (!found.ok) return deny(404, found.message);
        const shown = this.run(
          { type: 'goLive', presentationId: found.passage.passageId, slideIndex: 0 },
          who,
          `put up ${found.passage.reference}`,
        );
        return shown.status === 200
          ? ok({ ...(shown.body as object), reference: found.passage.reference })
          : shown;
      }
      case 'music.play': {
        // An audio playlist a phone chose (Session 54, D5), or none: on from where it was paused.
        const chosen = args['playlistId'] ?? null;
        const playlistId = chosen === null ? null : idSchema.safeParse(chosen).data;
        if (playlistId === undefined) return deny(400, 'Which audio playlist?');
        const played = this.deps.playMusic(who, playlistId);
        return played.ok ? ok({ playing: true }) : deny(409, played.message);
      }
      case 'playlists':
        return ok({ playlists: this.deps.reads.playlists() });
      case 'items': {
        const id = idSchema.safeParse(args['playlistId']);
        return id.success
          ? ok({ items: this.deps.reads.items(id.data) })
          : deny(404, 'There is no such playlist.');
      }
      case 'presentation': {
        const id = idSchema.safeParse(args['presentationId']);
        const doc = id.success ? this.deps.reads.presentation(id.data) : null;
        return doc ? ok({ presentation: doc }) : deny(404, 'There is no such presentation.');
      }
      case 'presentations': {
        const offset = wholeNumber(args['offset'], 0, 0, 1_000_000);
        const limit = wholeNumber(args['limit'], REMOTE_LIBRARY_PAGE, 1, REMOTE_LIBRARY_MAX);
        const page: RemoteLibraryPage = { ...this.deps.reads.library(offset, limit), offset };
        return ok({ ...page });
      }
      case 'search': {
        const query = typeof args['query'] === 'string' ? cutText(args['query'].trim(), 200) : '';
        return ok({ ...this.deps.reads.search(query) });
      }
      case 'messages':
        return ok({ messages: this.deps.reads.messages() });
      case 'timers':
        return ok({ timers: this.deps.engine.state().timers });
      case 'logo': {
        const logo = this.deps.reads.logo();
        return ok({ logo: logo ? { id: logo.id, name: logo.name } : null });
      }
      case 'command':
        return this.command(args, who);
      case 'logo.set':
        return this.setLogo(args, who);
      case 'message.show':
        return this.showMessage(args, who);
      case 'message.hide': {
        const parsed = hideSchema.safeParse(args);
        if (!parsed.success) return deny(400, 'Which message?');
        return this.run(
          { type: 'hideMessage', messageId: messageItemId(parsed.data.templateId) },
          who,
          'took a message off',
        );
      }
      case 'keys':
      case 'props':
      case 'prop.show':
      case 'media':
      case 'media.show':
      case 'lowerThirds':
      case 'lowerThird.show':
      case 'music':
      case 'repeat.start':
        return mirrorAnswer(request.op, args, this.deps.mirror, (command, did) =>
          this.run(command, who, did),
        );
      case 'screens':
      case 'screens.addGroup':
      case 'screens.renameGroup':
      case 'screens.groupRole':
      case 'screens.deleteGroup':
      case 'screens.useDisplay':
      case 'screens.change':
      case 'screens.remove':
      case 'screens.keep':
      case 'screens.goBack':
      case 'screens.identify':
      case 'switch':
      case 'inputs':
      case 'input.add':
      case 'input.change':
      case 'input.remove':
      case 'windows':
      case 'window.show':
        return this.desktop
          ? this.desktop.answer(request.op, args, device, who)
          : deny(404, 'Drashti cannot set that up from a phone here.');
      case 'announce':
        return this.deps.announcements.submit(device, request.address, args);
      case 'announcement':
        return this.deps.announcements.statusFor(device, args);
      // Session 54: the playlists shared with phones, read-only.
      case 'shared':
        return ok({ playlists: this.deps.files?.shared() ?? [] });
      case 'shared.items': {
        const id = idSchema.safeParse(args['playlistId']);
        const items = id.success ? (this.deps.files?.sharedItems(id.data) ?? null) : null;
        return items ? ok({ items }) : deny(404, 'That playlist is not shared with phones.');
      }
      case 'me':
      case 'state':
      case 'preview':
      case 'uploads':
      case 'upload':
      case 'upload.status':
      case 'upload.piece':
      case 'upload.cancel':
      case 'media.picture':
      case 'media.original':
        return deny(400, 'The network server answers that itself.');
    }
  }

  private run(command: EngineCommand, who: string, did: string): DeviceAnswer {
    const result = this.deps.engine.dispatch(command);
    if (!result.ok)
      return {
        status: result.error === 'invalid-command' ? 400 : result.error === 'forbidden' ? 403 : 409,
        body: result,
      };
    this.deps.log('info', `Network: ${who} ${did}`);
    return ok({ changed: result.changed, rev: result.rev });
  }

  private command(args: Record<string, unknown>, who: string): DeviceAnswer {
    const parsed = parseEngineCommand(args);
    if (!parsed.ok) return deny(400, parsed.message);
    const type = parsed.command.type;
    if (!(REMOTE_COMMANDS as readonly string[]).includes(type))
      return deny(403, 'A Remote device cannot do that.');
    return this.run(parsed.command, who, type);
  }

  private setLogo(args: Record<string, unknown>, who: string): DeviceAnswer {
    const parsed = logoSchema.safeParse(args);
    if (!parsed.success) return deny(400, 'Logo on or off?');
    const on = parsed.data.on ?? this.deps.engine.state().logo === null;
    if (!on) return this.run({ type: 'hideLogo' }, who, 'took the logo down');
    const logo = this.deps.reads.logo();
    // In the operator window's own words (Session 54, D5 review).
    if (!logo) return deny(409, NO_LOGO_CHOSEN);
    return this.run({ type: 'showLogo', prop: logo }, who, 'showed the logo');
  }

  private showMessage(args: Record<string, unknown>, who: string): DeviceAnswer {
    const parsed = showSchema.safeParse(args);
    if (!parsed.success) return deny(400, 'Which message, with what in its fields?');
    const template = this.deps.reads.messages().find((t) => t.id === parsed.data.templateId);
    if (!template) return deny(404, 'There is no such message template.');
    const timers = this.deps.engine.state().timers;
    const filled = fillMessage(
      template,
      // In one form, NFC (Sessions 31–36, I18N-6).
      nfcDeep(parsed.data.values ?? {}),
      (id) => timers.find((t) => t.id === id)?.name ?? 'timer',
    );
    if (!filled.message) return deny(400, `Fill in ${filled.missing.map((n) => `{${n}}`).join(', ')} first.`);
    return this.run({ type: 'showMessage', message: filled.message }, who, 'showed a message');
  }

  /** At quit: let the devices know, and keep when they were last seen. */
  close(): Promise<void> {
    if (this.seenWriter) clearInterval(this.seenWriter);
    if (this.pairingTimer) clearTimeout(this.pairingTimer);
    if (this.seenNotice) clearTimeout(this.seenNotice);
    this.saveSeen();
    return this.stopServer();
  }

  /** The performance check: a paired device and its token, without the pairing dance. */
  pairForCheck(kind: DeviceKind, name: string): { id: string; token: string } {
    const token = newToken();
    const device = this.deps.devices.add({ name, kind, tokenHash: hashToken(token) });
    this.pushDevices();
    return { id: device.id, token };
  }
}

/** What the API's status says: where the show is, in short. */
export function summary(state: EngineState): Record<string, unknown> {
  const slide = state.layers.slide;
  return {
    live: {
      presentationId: state.live.presentationId,
      slideIndex: state.live.slideIndex,
      slideCount: state.live.slideCount,
      playlist: state.live.playlist,
      onScreen: slide !== null,
    },
    blackout: state.blackout,
    logo: state.logo !== null,
    canPutBack: state.canPutBack,
    next: state.next
      ? state.next.kind === 'slide'
        ? { kind: 'slide', presentationId: state.next.presentationId, slideIndex: state.next.slideIndex }
        : // A picture, video or sound item, or a video input's (Session 51): which, by its kind.
          { kind: state.next.kind, itemId: state.next.itemId, label: state.next.label }
      : null,
    messages: state.layers.messages.map((m) => ({ id: m.id, text: m.text })),
    ticker: state.layers.ticker?.items.map((i) => ({ id: i.id, text: i.text })) ?? [],
    timers: state.timers.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      running: t.startedAt !== null,
    })),
    stageMessage: state.stageMessage !== null,
    // Repeat Slides going round (Session 26d), or null.
    repeating: state.repeat ? { playlistId: state.repeat.playlistId, name: state.repeat.name } : null,
  };
}
