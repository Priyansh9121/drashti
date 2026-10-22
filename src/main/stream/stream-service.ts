import {
  type BrowserWindow,
  dialog,
  MessageChannelMain,
  type WebContents,
  type WebFrameMain,
} from 'electron';
import { basename } from 'node:path';
import type { EventChannel, EventContract } from '../../shared/ipc';
import { IPC } from '../../shared/ipc';
import type {
  CameraState,
  ProgramContext,
  ProgramInputs,
  SoundState,
  StreamLayout,
  StreamProfile,
  StreamProfileInput,
  StreamProfiles,
  StreamProfilesResult,
  StreamResult,
  StreamStatus,
} from '../../shared/stream';
import { placeName, STREAM_PRESETS } from '../../shared/stream';
import {
  deviceChoiceSchema,
  streamKeySchema,
  streamLayoutSchema,
  streamProfileInputSchema,
} from '../../shared/stream-schema';
import { z } from 'zod';
import type { ScreenRepo } from '../db/screens';
import type { SettingsRepo } from '../db/settings';
import type { StreamProfileRepo } from '../db/stream-profiles';
import { NO_SECURE_STORAGE, type StreamKeyStore } from './key-store';
import { safeAddress } from './redact';
import type { StreamWorker } from './stream-worker';
import { MAC_AUTHORITIES, streamAuthorities } from './tls';
import { pageAlive } from '../windows/send';
import type { ToStreamWorker, WorkerStatus } from './worker/protocol';
import { NO_SOUND_MS, type NoSound, NoSoundWatch } from './no-sound';
import { bytesPerHourAt, freeBytesOf, recordingWarning } from './recording-drive';
import { RestartCap } from './restart-cap';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileStamp } from '../../shared/format';
import { parsePlain } from '../../shared/plain-parse';
import type { ClockStyle } from '../../shared/format';

/*
 * The stream (PLAN.md 4.2), as the main process keeps it: the profiles and
 * their keys, the layout, the Program window (open only while something
 * needs it: the operator's preview, going live or recording), and what the
 * stream's page reports about its camera and sound input.
 */

export type MediaAccess = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

export interface StreamServiceDeps {
  /** How Main writes the time (Sessions 31–36, I18N-8), for the stream page's clocks. */
  clockStyle?(): ClockStyle;
  profiles: StreamProfileRepo;
  keys: StreamKeyStore;
  settings: SettingsRepo;
  screens: ScreenRepo;
  createProgram(size: { width: number; height: number }): BrowserWindow;
  sendToOperator<C extends EventChannel>(channel: C, payload: EventContract[C]): void;
  platform: NodeJS.Platform;
  /** The system's own camera and microphone permission for Drashti (macOS, Windows). */
  mediaAccess(kind: 'camera' | 'microphone'): MediaAccess;
  /** Ask the system for it (macOS shows its question once). */
  askMediaAccess(kind: 'camera' | 'microphone'): Promise<boolean>;
  /** ON AIR and REC for the window's own title ('' when neither). */
  titleMarks?(marks: string): void;
  /** How the stream stands, whenever the operator window is told (events out: Session 28). */
  statusChanged?(status: StreamStatus): void;
  /** The screen groups changed (the stream group was made): Screens shows it. */
  screensChanged(): void;
  /**
   * The Program's page became ready, was resized, or closed (Session 48): the window for Zoom captures it
   * afresh (programFrame()).
   */
  programChanged?(): void;
  /** The bundled FFmpeg, or null when it is missing. */
  ffmpegPath(): string | null;
  spawnWorker(): StreamWorker;
  /** Where the stream's state is kept between runs (to go live again after a crash). */
  stateFile: string;
  /** A sentence for the operator (the status bar's notice). */
  notice(text: string): void;
  now(): number;
  /** Tests: Chromium's fake camera and microphone stand in, and the system is not asked. */
  fakeDevices: boolean;
  /**
   * Tests (never a packaged Drashti): every place must be on this computer (127.0.0.1). Any other is refused,
   * loudly: no test ever streams to the internet.
   */
  onlyThisComputer?: boolean;
  /** Tests (DRASHTI_TEST_NO_SOUND_MS): how long quiet counts as No sound; 20 s otherwise. */
  noSoundMs?: number;
  /** Tests (DRASHTI_TEST_RECORD_PART_BYTES): how much a recording's part holds; 3.5 GB otherwise. */
  recordPartBytes?: number;
  /** Whether a folder is on a FAT drive, or null when that cannot be told (./recording-drive.ts). */
  recordingDrive?(folder: string): Promise<boolean | null>;
  log(level: 'info' | 'warn', message: string): void;
}

const PROFILE_SETTING = 'stream.profileId';
const LAYOUT_SETTING = 'stream.layout';
const FOLDER_SETTING = 'stream.recordingFolder';
/** Recording stops before the disk has less than this free (as backups and imports do). */
export const KEEP_FREE_BYTES = 2 * 1024 ** 3;
/** After an unexpected stop, Drashti goes live again by itself only if it starts again this soon. */
export const RESUME_WITHIN_MS = 5 * 60 * 1000;
/** No picture from the stream's page for this long, while wanted: it is given its port again (then 10 s, 20 s... to 1 min). */
const NO_PICTURE_MS = 5000;
export const FFMPEG_VERSION = '9.0.2';
const FFMPEG_MISSING =
  'Drashti’s copy of FFmpeg is missing, so it cannot stream or record. Install Drashti again (or, from the repository, run node scripts/fetch-ffmpeg.mjs).';

const savedStreamSchema = z.object({
  live: z.boolean(),
  recording: z.boolean(),
  profileId: z.string(),
  at: z.number(),
});
type SavedStream = z.infer<typeof savedStreamSchema>;

const NO_INPUTS: ProgramInputs = {
  cameras: [],
  microphones: [],
  camera: 'none',
  sound: 'none',
  message: null,
};

const inputsSchema = z.object({
  cameras: z.array(deviceChoiceSchema).max(50),
  microphones: z.array(deviceChoiceSchema).max(50),
  camera: z.enum(['none', 'starting', 'on', 'missing', 'blocked', 'failed']),
  sound: z.enum(['none', 'starting', 'on', 'missing', 'blocked', 'failed']),
  message: z.string().max(500).nullable(),
});

export class StreamService {
  private program: BrowserWindow | null = null;
  private programReady = false;
  /** When the stream's page last got the encoder's port, and how often since without a picture. */
  private encoderPaired = { at: 0, tries: 0 };
  private readonly watchers = new Map<number, WebContents>();
  /** What else keeps the Program open, by name (Session 48: the window for Zoom), without the preview's port. */
  private readonly holders = new Set<string>();
  private inputs: ProgramInputs = NO_INPUTS;
  private layout: StreamLayout;
  private systemBlocked: { camera: boolean; microphone: boolean } = { camera: false, microphone: false };
  /** Live and recording: kept by the encoder's side (stream/pipeline.ts) from step 2. */
  private live: StreamStatus['live'] = {
    state: 'off',
    since: null,
    health: 'off',
    bitrateKbps: null,
    fps: null,
    droppedFrames: 0,
    reconnects: 0,
    retryAt: null,
    message: null,
    destinations: [],
  };
  private recording: StreamStatus['recording'] = {
    state: 'off',
    since: null,
    file: null,
    folder: null,
    bytes: 0,
    freeBytes: null,
    secondsLeft: null,
    message: null,
    warning: null,
  };
  private encoder: string | null = null;
  /** The encoder found to work here (the worker tries it first next time). */
  private encoderName: string | null = null;
  private worker: StreamWorker | null = null;
  private workerStatus: WorkerStatus | null = null;
  private liveWanted = false;
  private recordWanted = false;
  /** After an unexpected stop: what was going on, to go live again or offer to. */
  private resume: StreamStatus['resume'] = null;
  private heartbeat: NodeJS.Timeout | null = null;
  /** Drashti is quitting: the stream's page is never opened again (a new window would stop the quit). */
  private closing = false;
  /** The profile last saved with the state, for a save made when the library can no longer be read. */
  private savedProfileId: string | null = null;
  private profilesVersion = 0;
  /** No sound (Session 31): judged from the worker's quiet count and the microphone's state. */
  private readonly noSoundWatch: NoSoundWatch;
  private noSound: NoSound | null = null;
  /**
   * The stream's page started again after a crash at most 5 times a minute (Session 31, ROB-7); then it
   * is left stopped (`pageStopped`) until someone presses Try again.
   */
  private readonly pageRestarts = new RestartCap();
  private pageStopped = false;

  constructor(private readonly deps: StreamServiceDeps) {
    this.noSoundWatch = new NoSoundWatch(deps.noSoundMs ?? NO_SOUND_MS);
    const saved = streamLayoutSchema.safeParse(deps.settings.get(LAYOUT_SETTING));
    this.layout = saved.success ? saved.data : 'camera';
    const folder = z.string().safeParse(deps.settings.get(FOLDER_SETTING));
    this.recording.folder = folder.success ? folder.data : null;
    // The profile in use, made now if there is none: asking for the status then never writes (it is
    // asked for as the operator window opens, when an import may be writing).
    this.activeProfile();
  }

  // ---- profiles and keys ---------------------------------------------------------------

  /** The profile in use (made the first time it is asked for). */
  activeProfile(): StreamProfile {
    const id = z.string().safeParse(this.deps.settings.get(PROFILE_SETTING));
    const found = id.success ? this.deps.profiles.get(id.data) : null;
    if (found) return found;
    const first = this.deps.profiles.ensureOne();
    this.deps.settings.set(PROFILE_SETTING, first.id);
    return first;
  }

  /**
   * The stream's group in Screens (its languages), made the first time the
   * operator turns to the stream: the Stream panel or its settings, going
   * live or recording. Never by the setup wizard on its own.
   */
  ensureStreamGroup(): void {
    if (this.deps.screens.streamGroup() !== null) return;
    this.deps.screens.ensureStreamGroup();
    this.deps.screensChanged();
    // The stream's page draws in its group's settings in the live Look: it learns the group now.
    this.contextChanged();
  }

  profilesView(): StreamProfiles {
    const active = this.activeProfile();
    return { profiles: this.deps.profiles.list(), activeId: active.id, keyStorage: this.deps.keys.status() };
  }

  /** On air or recording: the profile in use and its inputs stay as they are. */
  inUse(): boolean {
    return this.liveWanted || this.recordWanted;
  }

  /** On air (or getting there) and recording, as the operator asked: for the quit question. */
  wanted(): { live: boolean; recording: boolean } {
    return { live: this.liveWanted, recording: this.recordWanted };
  }

  saveProfile(rawId: unknown, rawInput: unknown): StreamProfilesResult {
    const input = parsePlain(
      streamProfileInputSchema,
      rawInput,
      'That stream profile cannot be kept: check its settings, then save again.',
    );
    if (!input.success) return { ok: false, message: input.message };
    const id = rawId === null ? null : z.string().max(100).safeParse(rawId);
    if (id === null) {
      const made = this.deps.profiles.create(input.data);
      this.deps.settings.set(PROFILE_SETTING, made);
    } else {
      if (!id.success || !this.deps.profiles.get(id.data))
        return { ok: false, message: 'That profile no longer exists.' };
      const before = this.deps.profiles.get(id.data);
      if (
        this.inUse() &&
        id.data === this.activeProfile().id &&
        before &&
        this.liveSettingsChanged(before, input.data)
      )
        return {
          ok: false,
          message: 'End the stream and stop recording before changing where it goes or its preset.',
        };
      this.deps.profiles.update(id.data, input.data);
      // A place taken out takes its key with it.
      const after = this.deps.profiles.get(id.data);
      for (const d of before?.more ?? [])
        if (!after?.more.some((x) => x.id === d.id)) this.deps.keys.remove(d.id);
    }
    this.contextChanged();
    this.profilesVersion++;
    this.changed();
    return { ok: true, profiles: this.profilesView() };
  }

  /** While on air, the camera, sound and delay may change; where it goes (every place) and how may not. */
  private liveSettingsChanged(before: StreamProfile, after: StreamProfileInput): boolean {
    const places = (more: readonly { url: string }[]) => more.map((d) => d.url).join(' ');
    return (
      before.url !== after.url ||
      before.preset !== after.preset ||
      (after.more !== undefined && places(before.more) !== places(after.more))
    );
  }

  /**
   * The camera and sound input of the profile in use, as Screens' YouTube card and the setup wizard set
   * them (also on air: they may change then, as in the profile's settings).
   */
  setInputs(rawCamera: unknown, rawSound: unknown): StreamResult {
    const camera = deviceChoiceSchema.nullable().safeParse(rawCamera);
    const sound = deviceChoiceSchema.nullable().safeParse(rawSound);
    if (!camera.success || !sound.success)
      return { ok: false, message: 'Choose a camera and a sound input.' };
    const { id, hasKey: _hasKey, more: _more, ...input } = this.activeProfile();
    this.deps.profiles.update(id, { ...input, camera: camera.data, sound: sound.data });
    this.contextChanged();
    this.profilesVersion++;
    this.changed();
    return { ok: true, status: this.status() };
  }

  removeProfile(rawId: unknown): StreamProfilesResult {
    const id = z.string().max(100).safeParse(rawId);
    if (!id.success || !this.deps.profiles.get(id.data))
      return { ok: false, message: 'That profile no longer exists.' };
    if (this.inUse() && id.data === this.activeProfile().id)
      return { ok: false, message: 'This profile is in use: end the stream and stop recording first.' };
    if (this.deps.profiles.list().length <= 1) return { ok: false, message: 'Keep at least one profile.' };
    // Its own key and each other place's.
    const keys = this.deps.profiles.keyIds(id.data);
    this.deps.profiles.remove(id.data);
    for (const key of keys) this.deps.keys.remove(key);
    this.contextChanged();
    this.profilesVersion++;
    this.changed();
    return { ok: true, profiles: this.profilesView() };
  }

  useProfile(rawId: unknown): StreamProfilesResult {
    const id = z.string().max(100).safeParse(rawId);
    if (!id.success || !this.deps.profiles.get(id.data))
      return { ok: false, message: 'That profile no longer exists.' };
    if (this.inUse() && id.data !== this.activeProfile().id)
      return { ok: false, message: 'End the stream and stop recording before changing profile.' };
    this.deps.settings.set(PROFILE_SETTING, id.data);
    this.contextChanged();
    this.profilesVersion++;
    this.changed();
    return { ok: true, profiles: this.profilesView() };
  }

  /** Which key a profile's place keeps (its own: the profile's id; another place: that place's), or null. */
  private keyId(rawId: unknown, rawPlace: unknown): { keyId: string; url: string } | null {
    const id = z.string().max(100).safeParse(rawId);
    const profile = id.success ? this.deps.profiles.get(id.data) : null;
    if (!profile) return null;
    if (rawPlace === undefined || rawPlace === null || rawPlace === '')
      return { keyId: profile.id, url: profile.url };
    const place = profile.more.find((d) => d.id === rawPlace);
    return place ? { keyId: place.id, url: place.url } : null;
  }

  setKey(rawId: unknown, rawKey: unknown, rawPlace?: unknown): StreamProfilesResult {
    const place = this.keyId(rawId, rawPlace);
    if (!place) return { ok: false, message: 'That profile no longer exists.' };
    const key = streamKeySchema.safeParse(rawKey);
    if (!key.success) {
      const name = placeName(place.url);
      const from = name === 'YouTube' ? ' from YouTube Studio' : name === 'Facebook' ? ' from Facebook' : '';
      return { ok: false, message: `Paste the stream key${from}: letters, digits and dashes.` };
    }
    const kept = this.deps.keys.set(place.keyId, key.data);
    if (!kept.ok) return kept;
    this.deps.log('info', 'A stream key was saved');
    this.changed();
    this.profilesVersion++;
    this.changed();
    return { ok: true, profiles: this.profilesView() };
  }

  removeKey(rawId: unknown, rawPlace?: unknown): StreamProfilesResult {
    const place = this.keyId(rawId, rawPlace);
    if (!place) return { ok: false, message: 'That profile no longer exists.' };
    this.deps.keys.remove(place.keyId);
    this.changed();
    this.profilesVersion++;
    this.changed();
    return { ok: true, profiles: this.profilesView() };
  }

  // ---- the Program ---------------------------------------------------------------------

  setLayout(raw: unknown): StreamResult {
    const layout = streamLayoutSchema.safeParse(raw);
    if (!layout.success) return { ok: false, message: 'The stream shows the camera or the slides.' };
    this.layout = layout.data;
    this.deps.settings.set(LAYOUT_SETTING, layout.data);
    this.contextChanged();
    return { ok: true, status: this.status() };
  }

  /** What the stream's page draws and opens. */
  context(): ProgramContext {
    const profile = this.activeProfile();
    const preset = STREAM_PRESETS[profile.preset];
    return {
      layout: this.layout,
      // The stream group: its languages are in the live Look (every language until it is made: ensureStreamGroup).
      groupId: this.deps.screens.streamGroup()?.id ?? null,
      width: preset.width,
      height: preset.height,
      camera: this.systemBlocked.camera ? null : profile.camera,
      sound: this.systemBlocked.microphone ? null : profile.sound,
      soundDelayMs: profile.soundDelayMs,
      mixOwnSound: profile.mixOwnSound,
      capturing: this.liveWanted || this.recordWanted,
      preview: this.watchers.size > 0,
      ...(this.deps.clockStyle ? { clockStyle: this.deps.clockStyle() } : {}),
    };
  }

  /** The Program window's page while it is open (tests hold its clock with the outputs', Session 27). */
  programContents(): WebContents | null {
    return this.program && !this.program.isDestroyed() ? this.program.webContents : null;
  }

  isProgram(contents: WebContents | null): boolean {
    return (
      contents !== null &&
      this.program !== null &&
      !this.program.isDestroyed() &&
      contents.id === this.program.webContents.id
    );
  }

  /** The Program's page and its size, once it is open and ready (Session 48: the window for Zoom shows it). */
  programFrame(): { frame: WebFrameMain; width: number; height: number } | null {
    const program = this.program;
    if (!pageAlive(program) || !this.programReady) return null;
    const [width = 0, height = 0] = program.getContentSize();
    return { frame: program.webContents.mainFrame, width, height };
  }

  /**
   * Keep the Program open (or let it go) for something other than the preview (Session 48: the window for
   * Zoom), as the preview does: whether or not the stream is on air or recording.
   */
  hold(who: string, on: boolean): void {
    if (on) this.holders.add(who);
    else this.holders.delete(who);
    this.updateProgram();
  }

  /** The Program window is open while the preview is watched, something holds it, or the stream is live or recording. */
  private updateProgram(): void {
    // Stopped after crashing too often: only Try again starts it (tryAgainPage).
    if (this.closing || this.pageStopped) return;
    const wanted = this.watchers.size > 0 || this.holders.size > 0 || this.inUse();
    if (wanted && (!this.program || this.program.isDestroyed())) {
      void this.openProgram();
    } else if (!wanted && this.program && !this.program.isDestroyed()) {
      this.deps.log('info', "The stream's page closes: nothing needs it");
      this.program.destroy();
      this.program = null;
      this.programReady = false;
      this.inputs = NO_INPUTS;
      this.changed();
      this.deps.programChanged?.();
    }
  }

  private async openProgram(): Promise<void> {
    await this.checkSystemAccess();
    // Drashti may have begun to quit while the system asked (a new window would stop the quit).
    if (this.closing) return;
    if (this.program && !this.program.isDestroyed()) return;
    const { width, height } = this.context();
    const win = this.deps.createProgram({ width, height });
    this.deps.log('info', `The stream's page opens (${String(width)}x${String(height)})`);
    this.program = win;
    this.programReady = false;
    win.webContents.on('did-finish-load', () => {
      this.deps.log('info', "The stream's page loaded");
      this.programReady = true;
      this.pairPreviews();
      this.pairEncoder();
      this.changed();
      this.deps.programChanged?.();
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      this.programReady = false;
      if (!win.isDestroyed()) win.destroy();
      if (this.program === win) this.program = null;
      this.deps.programChanged?.();
      if (!this.pageRestarts.allow(this.deps.now())) {
        this.pageStopped = true;
        this.deps.log(
          'warn',
          `The stream’s page stopped (${details.reason}) for the sixth time in a minute: it stays stopped until Try again`,
        );
        this.changed();
        return;
      }
      this.deps.log('warn', `The stream's page stopped (${details.reason}); starting it again`);
      setTimeout(() => {
        this.updateProgram();
      }, 500);
    });
    win.on('closed', () => {
      if (this.program === win) {
        this.program = null;
        this.programReady = false;
      }
    });
    this.changed();
  }

  /** Ask the system for the camera and microphone the profile uses (once; macOS shows its question). */
  private async checkSystemAccess(): Promise<void> {
    if (this.deps.fakeDevices) {
      this.systemBlocked = { camera: false, microphone: false };
      return;
    }
    const profile = this.activeProfile();
    const check = async (kind: 'camera' | 'microphone', wanted: boolean): Promise<boolean> => {
      if (!wanted) return false;
      let access = this.deps.mediaAccess(kind);
      if (access === 'not-determined' && this.deps.platform === 'darwin')
        access = (await this.deps.askMediaAccess(kind)) ? 'granted' : 'denied';
      return access === 'denied' || access === 'restricted';
    };
    this.systemBlocked = {
      camera: await check('camera', profile.camera !== null),
      microphone: await check('microphone', profile.sound !== null),
    };
  }

  /** Give each window watching the preview a port to the stream's page. */
  private pairPreviews(): void {
    const program = this.program;
    if (!pageAlive(program) || !this.programReady) return;
    for (const contents of this.watchers.values()) {
      if (contents.isDestroyed()) continue;
      const { port1, port2 } = new MessageChannelMain();
      program.webContents.postMessage(IPC.stream.port, { role: 'preview' }, [port1]);
      contents.postMessage(IPC.stream.port, { role: 'preview' }, [port2]);
    }
  }

  watchPreview(contents: WebContents, on: boolean): void {
    if (on) {
      if (!this.watchers.has(contents.id)) {
        this.watchers.set(contents.id, contents);
        contents.once('destroyed', () => {
          this.watchers.delete(contents.id);
          this.contextChanged();
          this.updateProgram();
        });
      }
    } else {
      this.watchers.delete(contents.id);
    }
    this.updateProgram();
    this.contextChanged();
    if (on) this.pairPreviews();
  }

  /** The stream's page says what it sees. */
  reportInputs(contents: WebContents, raw: unknown): void {
    if (!this.isProgram(contents)) return;
    const parsed = inputsSchema.safeParse(raw);
    if (!parsed.success) return;
    this.inputs = parsed.data;
    this.changed();
  }

  /** Something the page draws or opens changed. */
  contextChanged(): void {
    const program = this.program;
    if (pageAlive(program) && this.programReady) {
      const context = this.context();
      const [w, h] = program.getContentSize();
      if (w !== context.width || h !== context.height) {
        program.setContentSize(context.width, context.height);
        this.deps.programChanged?.();
        const [nw, nh] = program.getContentSize();
        if (nw !== context.width || nh !== context.height)
          this.deps.log(
            'warn',
            `The stream’s page is ${String(nw)}x${String(nh)}, not the ${String(context.width)}x${String(context.height)} asked`,
          );
      }
      program.webContents.send(IPC.stream.context, context);
    }
    if (program && !program.isDestroyed()) void this.checkSystemAccess();
    this.changed();
  }

  // ---- status ----------------------------------------------------------------------------

  /** A sentence for the operator about the camera and sound input, when they need attention. */
  private inputsMessage(): string | null {
    const profile = this.activeProfile();
    const mac = this.deps.platform === 'darwin';
    const camera: CameraState = this.systemBlocked.camera ? 'blocked' : this.inputs.camera;
    const sound: SoundState = this.systemBlocked.microphone ? 'blocked' : this.inputs.sound;
    const name = (d: { label: string } | null, fallback: string) => (d ? `“${d.label}”` : fallback);
    if (camera === 'blocked')
      return mac
        ? 'macOS is not letting Drashti use the camera. Open System Settings > Privacy & Security > Camera, turn on Drashti, then open the Stream panel again.'
        : 'Windows is blocking the camera. Open Settings > Privacy & security > Camera, turn on Camera access and “Let desktop apps access your camera”, then open the Stream panel again.';
    if (sound === 'blocked')
      return mac
        ? 'macOS is not letting Drashti use the sound input. Open System Settings > Privacy & Security > Microphone, turn on Drashti, then open the Stream panel again.'
        : 'Windows is blocking the sound input. Open Settings > Privacy & security > Microphone, turn on Microphone access and “Let desktop apps access your microphone”, then open the Stream panel again.';
    if (camera === 'missing')
      return `The camera ${name(profile.camera, '')} is not connected. Connect it, or choose another in Stream settings.`;
    if (camera === 'failed')
      return `The camera ${name(profile.camera, '')} would not start: another app may be using it. Close that app, or choose another camera.`;
    if (sound === 'missing')
      return `The sound input ${name(profile.sound, '')} is not connected. Connect it, or choose another in Stream settings.`;
    if (sound === 'failed') return `The sound input ${name(profile.sound, '')} would not start.`;
    return null;
  }

  status(): StreamStatus {
    const profile = this.activeProfile();
    return {
      programOn: this.program !== null && this.programReady,
      layout: this.layout,
      profileId: profile.id,
      chosen: { camera: profile.camera, sound: profile.sound },
      inputs: {
        ...this.inputs,
        camera: this.systemBlocked.camera ? 'blocked' : this.inputs.camera,
        sound: this.systemBlocked.microphone ? 'blocked' : this.inputs.sound,
        message: this.inputsMessage(),
      },
      live: { ...this.live },
      recording: { ...this.recording, file: this.recording.file ? basename(this.recording.file) : null },
      encoder: this.workerStatus?.encoder?.label ?? this.encoder,
      ffmpeg: { available: this.deps.ffmpegPath() !== null, version: FFMPEG_VERSION },
      resume: this.resume,
      profilesVersion: this.profilesVersion,
      noSound: this.noSound ? { ...this.noSound, message: this.noSoundMessage(this.noSound) } : null,
      pageStopped: this.pageStopped,
    };
  }

  /**
   * No sound (Session 31): on air or recording, how long the worker has heard nothing, and whether the
   * microphone is gone. Said in the log only when it starts and ends, never every second.
   */
  private judgeSound(): void {
    const onAir = this.live.state === 'live' || this.live.state === 'reconnecting';
    const active = onAir || this.recording.state === 'recording';
    const input: SoundState = this.systemBlocked.microphone ? 'blocked' : this.inputs.sound;
    const quietMs = this.worker ? (this.workerStatus?.quietMs ?? 0) : 0;
    const r = this.noSoundWatch.update({ active, quietMs, input, now: this.deps.now() });
    if (!r.changed) return;
    const before = this.noSound;
    this.noSound = r.now;
    if (r.now)
      this.deps.log(
        'warn',
        r.now.why === 'input'
          ? 'No sound: the sound input is gone, and nothing has reached the stream since'
          : `No sound: nothing above -50 dBFS has reached the stream for ${String(Math.round(this.noSoundWatch.limit / 1000))} s`,
      );
    else if (before && active) this.deps.log('info', 'The stream has sound again');
  }

  /** What the No sound notice says: why, and what to do. */
  private noSoundMessage(n: NoSound): string {
    if (n.why === 'input')
      return `${this.inputsMessage() ?? 'The sound input is not working.'} Until then the stream has no sound.`;
    const seconds = String(Math.round(this.noSoundWatch.limit / 1000));
    const profile = this.activeProfile();
    if (profile.sound === null && !profile.mixOwnSound)
      return `No sound input is chosen for the stream, so it has had no sound for ${seconds} seconds. Choose one in Stream settings.`;
    return `The stream has had no sound for ${seconds} seconds. Check the microphone, its cable and the sound desk.`;
  }

  private marks = '';

  private changed(): void {
    this.judgeSound();
    const status = this.status();
    this.deps.sendToOperator(IPC.stream.changed, status);
    this.deps.statusChanged?.(status);
    const onAir = status.live.state === 'live' || status.live.state === 'reconnecting';
    const marks = [onAir ? 'ON AIR' : '', status.recording.state === 'recording' ? 'REC' : '']
      .filter(Boolean)
      .join(' · ');
    if (marks !== this.marks) {
      this.marks = marks;
      this.deps.titleMarks?.(marks);
    }
  }

  // ---- going live and recording -----------------------------------------------------------

  /** The worker (encoding, sending, recording) runs while the stream is live or recording. */
  private ensureWorker(ffmpeg: string): StreamWorker {
    if (this.worker) return this.worker;
    const worker = this.deps.spawnWorker();
    this.worker = worker;
    worker.onMessage((m) => {
      if (this.worker !== worker) return;
      if (m.type === 'log') this.deps.log(m.level, `[stream] ${m.message}`);
      else this.fromWorker(m.status);
    });
    worker.onExit(() => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.workerStatus = null;
      if (this.inUse()) {
        // It stopped by itself: start it again with what was wanted.
        this.deps.log('warn', 'The stream worker stopped; starting it again');
        setTimeout(() => {
          this.restartWorker();
        }, 1000);
      }
    });
    const preset = STREAM_PRESETS[this.activeProfile().preset];
    const caFile = streamAuthorities(this.deps.platform, existsSync);
    if (this.deps.platform === 'darwin' && caFile === null)
      this.deps.log(
        'warn',
        `${MAC_AUTHORITIES} is missing: a secure stream (rtmps://) cannot have its server’s certificate checked, so it will not go on air`,
      );
    worker.send({
      type: 'start',
      ffmpeg,
      platform: this.deps.platform,
      preset,
      encoder: this.encoderName,
      caFile,
    });
    this.updateProgram();
    this.pairEncoder();
    return worker;
  }

  private restartWorker(): void {
    const ffmpeg = this.deps.ffmpegPath();
    if (!ffmpeg || !this.inUse()) return;
    const worker = this.ensureWorker(ffmpeg);
    const profile = this.activeProfile();
    if (this.liveWanted) {
      const places = this.placesOf(profile);
      if (places.ok) worker.send({ type: 'live', url: profile.url, key: places.key, more: places.more });
    }
    if (this.recordWanted && this.recording.file) worker.send(this.recordMessage());
  }

  /** Give the worker a port to the stream's page for its frames and sound. */
  private pairEncoder(): void {
    const program = this.program;
    const worker = this.worker;
    if (!worker || !pageAlive(program) || !this.programReady) return;
    const { port1, port2 } = new MessageChannelMain();
    worker.sendFrames(port1);
    program.webContents.postMessage(IPC.stream.port, { role: 'encoder' }, [port2]);
    this.deps.log('info', "The stream's page was given the encoder");
    this.encoderPaired.at = this.deps.now();
    this.contextChanged();
  }

  /**
   * Live or recording, the encoder chosen, but no picture: the page's port went astray (or its capture
   * failed). Give it a new one, waiting longer each time, so a capture that keeps failing is not
   * flooded; a picture resets the wait.
   */
  private checkPicture(status: WorkerStatus): void {
    if (status.encoding || !this.inUse() || !status.encoder || status.error || !this.programReady) {
      if (status.encoding) this.encoderPaired.tries = 0;
      return;
    }
    const wait = Math.min(60_000, NO_PICTURE_MS * 2 ** this.encoderPaired.tries);
    if (this.deps.now() - this.encoderPaired.at < wait) return;
    this.encoderPaired.tries++;
    this.deps.log(
      'warn',
      `The stream has had no picture from its page for ${wait / 1000} s: connecting it again`,
    );
    this.pairEncoder();
  }

  /** Stop the worker when neither live nor recording is wanted. */
  private settleWorker(): void {
    if (this.inUse() || !this.worker) return;
    this.worker.send({ type: 'stop' });
    const worker = this.worker;
    setTimeout(() => {
      worker.kill();
    }, 5000).unref();
    this.worker = null;
    this.workerStatus = null;
    this.contextChanged();
    this.updateProgram();
  }

  private fromWorker(status: WorkerStatus): void {
    this.workerStatus = status;
    if (status.encoder) {
      this.encoderName = status.encoder.name;
      this.encoder = status.encoder.label;
    }
    const w = status.live;
    if (this.liveWanted) {
      this.live = {
        state: w.state === 'live' ? 'live' : w.state === 'reconnecting' ? 'reconnecting' : 'starting',
        since: w.since,
        health: w.health,
        bitrateKbps: w.bitrateKbps,
        fps: status.fps,
        droppedFrames: status.droppedFrames,
        reconnects: w.reconnects,
        retryAt: w.retryAt,
        message: status.error ?? w.message,
        destinations: status.destinations.map((d) => ({
          id: d.id,
          name: d.name,
          state: d.state === 'live' ? 'live' : d.state === 'reconnecting' ? 'reconnecting' : 'starting',
          since: d.since,
          health: d.health,
          bitrateKbps: d.bitrateKbps,
          reconnects: d.reconnects,
          retryAt: d.retryAt,
          message: d.message,
        })),
      };
    }
    const r = status.recording;
    const rate = r.rate ?? null;
    const left =
      r.freeBytes !== null && rate !== null && rate > 0
        ? Math.max(0, (r.freeBytes - KEEP_FREE_BYTES) / rate)
        : null;
    if (this.recordWanted && r.state === 'off' && r.message) {
      // The worker stopped the recording (the disk is nearly full): the stream goes on.
      this.recordWanted = false;
      this.deps.notice(r.message);
    }
    this.recording = {
      ...this.recording,
      state: r.state === 'recording' ? 'recording' : this.recordWanted ? 'starting' : 'off',
      since: r.since,
      file: r.file,
      bytes: r.bytes,
      freeBytes: r.freeBytes,
      secondsLeft: left,
      message: status.error ?? r.message,
    };
    this.saveState();
    this.changed();
    if (!this.inUse()) this.settleWorker();
    else this.checkPicture(status);
  }

  /**
   * Where going live sends the stream (Session 28): the profile's own address with its key, and each other
   * place with its own; or why it cannot go (a key missing or unreadable; a test's address off this computer).
   */
  private placesOf(
    profile: StreamProfile,
  ):
    | { ok: true; key: string; more: { id: string; url: string; key: string }[] }
    | { ok: false; message: string } {
    const key = this.deps.keys.get(profile.id);
    if (!key) {
      const storage = this.deps.keys.status();
      if (!storage.available) return { ok: false, message: storage.message ?? NO_SECURE_STORAGE };
      return {
        ok: false,
        message: this.deps.keys.has(profile.id)
          ? `The stream key saved for “${profile.name}” cannot be read any more (this computer’s secure storage changed). Paste it again in Stream settings.`
          : `There is no stream key for “${profile.name}”. Paste it in Stream settings first.`,
      };
    }
    const more: { id: string; url: string; key: string }[] = [];
    for (const d of profile.more) {
      const its = this.deps.keys.get(d.id);
      if (!its)
        return {
          ok: false,
          message: `There is no stream key for ${placeName(d.url)} in “${profile.name}” (${safeAddress(d.url)}). Paste it in Stream settings, or take that place out.`,
        };
      more.push({ id: d.id, url: d.url, key: its });
    }
    if (this.deps.onlyThisComputer) {
      const away = [profile.url, ...profile.more.map((d) => d.url)].filter(
        (u) => !/^rtmps?:\/\/127\.0\.0\.1[:/]/u.test(u),
      );
      if (away.length > 0) {
        this.deps.log(
          'warn',
          `TEST GUARD: going live refused: ${away.map(safeAddress).join(', ')} is not 127.0.0.1`,
        );
        return { ok: false, message: 'A test streams only to this computer (127.0.0.1).' };
      }
    }
    return { ok: true, key, more };
  }

  goLive(): StreamResult {
    if (this.liveWanted) return { ok: false, message: 'The stream is already on air.' };
    const ffmpeg = this.deps.ffmpegPath();
    if (!ffmpeg) return { ok: false, message: FFMPEG_MISSING };
    const profile = this.activeProfile();
    const places = this.placesOf(profile);
    if (!places.ok) return places;
    this.ensureStreamGroup();
    this.liveWanted = true;
    this.resume = null;
    this.live = {
      ...this.live,
      state: 'starting',
      since: null,
      message: 'Starting…',
      reconnects: 0,
      droppedFrames: 0,
    };
    const worker = this.ensureWorker(ffmpeg);
    worker.send({ type: 'live', url: profile.url, key: places.key, more: places.more });
    this.deps.log(
      'info',
      `Going live with the profile “${profile.name}” (${STREAM_PRESETS[profile.preset].label})${places.more.length > 0 ? ` to ${String(places.more.length + 1)} places` : ''}`,
    );
    this.startHeartbeat();
    this.saveState();
    this.contextChanged();
    return { ok: true, status: this.status() };
  }

  end(): StreamResult {
    if (!this.liveWanted) return { ok: false, message: 'The stream is not on air.' };
    this.liveWanted = false;
    this.worker?.send({ type: 'endLive' });
    this.live = {
      state: 'off',
      since: null,
      health: 'off',
      bitrateKbps: null,
      fps: null,
      droppedFrames: 0,
      reconnects: 0,
      retryAt: null,
      message: null,
      destinations: [],
    };
    this.deps.log('info', 'The stream was ended');
    this.saveState();
    this.settleWorker();
    this.changed();
    return { ok: true, status: this.status() };
  }

  /** A new recording file's name: Drashti and the local date and time. */
  private nextFile(): string {
    const folder = this.recording.folder ?? '';
    let file = join(folder, `Drashti ${fileStamp(new Date(this.deps.now()))}.mkv`);
    for (let n = 2; existsSync(file); n++)
      file = join(folder, `Drashti ${fileStamp(new Date(this.deps.now()))} (${n}).mkv`);
    return file;
  }

  startRecording(): StreamResult {
    if (this.recordWanted) return { ok: false, message: 'It is already recording.' };
    const ffmpeg = this.deps.ffmpegPath();
    if (!ffmpeg) return { ok: false, message: FFMPEG_MISSING };
    const folder = this.recording.folder;
    if (!folder || !existsSync(folder))
      return { ok: false, message: 'Choose a folder for recordings first.' };
    this.ensureStreamGroup();
    this.recordWanted = true;
    this.resume = null;
    this.recording = {
      ...this.recording,
      state: 'starting',
      message: null,
      warning: null,
      bytes: 0,
      since: null,
    };
    const worker = this.ensureWorker(ffmpeg);
    worker.send(this.recordMessage());
    this.startHeartbeat();
    this.saveState();
    this.contextChanged();
    void this.lookAtRecordingDrive(folder);
    return { ok: true, status: this.status() };
  }

  /** The worker's next recording: a new file, the space kept free, and how much a part holds. */
  private recordMessage(): ToStreamWorker {
    return {
      type: 'record',
      file: this.nextFile(),
      keepFreeBytes: KEEP_FREE_BYTES,
      ...(this.deps.recordPartBytes ? { partBytes: this.deps.recordPartBytes } : {}),
    };
  }

  /**
   * As a recording starts: is its folder on a FAT32 drive, or its disk nearly full? Said once, plainly,
   * in the status bar and the Stream panel (Session 31, MED-2); nothing when it cannot be told.
   */
  private async lookAtRecordingDrive(folder: string): Promise<void> {
    const preset = STREAM_PRESETS[this.activeProfile().preset];
    const [fat, freeBytes] = await Promise.all([
      this.deps.recordingDrive ? this.deps.recordingDrive(folder) : Promise.resolve(null),
      freeBytesOf(folder),
    ]);
    if (!this.recordWanted || this.recording.folder !== folder) return;
    const warning = recordingWarning({
      fat,
      freeBytes,
      bytesPerHour: bytesPerHourAt(preset),
      keepFree: KEEP_FREE_BYTES,
    });
    if (!warning) return;
    this.recording = { ...this.recording, warning };
    this.deps.log('warn', `Recording: ${warning}`);
    this.deps.notice(warning);
    this.changed();
  }

  stopRecording(): StreamResult {
    if (!this.recordWanted) return { ok: false, message: 'Nothing is being recorded.' };
    this.recordWanted = false;
    this.worker?.send({ type: 'stopRecording' });
    this.recording = { ...this.recording, state: 'off', secondsLeft: null, message: null, warning: null };
    this.saveState();
    this.settleWorker();
    this.changed();
    return { ok: true, status: this.status() };
  }

  // ---- after an unexpected stop ----------------------------------------------------------

  private startHeartbeat(): void {
    this.heartbeat ??= setInterval(() => {
      if (this.inUse()) this.saveState();
      else if (this.heartbeat) {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
      }
    }, 5000);
  }

  /** What is going on, kept on disk (no key): after a crash, Drashti knows to go live again. */
  private saveState(): void {
    try {
      let profileId: string;
      try {
        profileId = this.activeProfile().id;
      } catch (error) {
        // The library could not be read (Session 23: at quit it had closed first): the stream's own
        // state matters more than its profile, so keep the profile last saved.
        if (this.savedProfileId === null) throw error;
        profileId = this.savedProfileId;
      }
      this.savedProfileId = profileId;
      const state: SavedStream = {
        live: this.liveWanted,
        recording: this.recordWanted,
        profileId,
        at: this.deps.now(),
      };
      const tmp = `${this.deps.stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(state));
      renameSync(tmp, this.deps.stateFile);
    } catch (error) {
      this.deps.log('warn', `The stream's state could not be kept: ${String(error)}`);
    }
  }

  /**
   * At the start: if Drashti stopped while on air or recording (no End, no
   * Stop), go live and record again by itself when that was under 5 minutes
   * ago, with the same profile; after that, only offer to. A new recording
   * file starts either way; the old one stays as it is and plays. Never after
   * a quit on purpose (`cleanQuit`, from restart recovery: Session 23), even if
   * the file still says live.
   */
  resumeAfterStop(options: { cleanQuit: boolean }): string | null {
    let saved: SavedStream;
    try {
      saved = savedStreamSchema.parse(JSON.parse(readFileSync(this.deps.stateFile, 'utf8')));
    } catch {
      return null;
    }
    if (!saved.live && !saved.recording) return null;
    if (options.cleanQuit) {
      this.deps.log(
        'info',
        'The stream was in use when Drashti last quit on purpose: it does not start again',
      );
      try {
        writeFileSync(this.deps.stateFile, JSON.stringify({ ...saved, live: false, recording: false }));
      } catch {
        // Read as a clean quit next time too.
      }
      return null;
    }
    const profile = this.deps.profiles.get(saved.profileId);
    if (!profile) return null;
    if (this.activeProfile().id !== profile.id) this.deps.settings.set(PROFILE_SETTING, profile.id);
    const ago = this.deps.now() - saved.at;
    const what = saved.live && saved.recording ? 'on air and recording' : saved.live ? 'on air' : 'recording';
    if (ago > RESUME_WITHIN_MS) {
      this.resume = {
        live: saved.live,
        recording: saved.recording,
        profileName: profile.name,
        stoppedAt: saved.at,
      };
      // Offered once: if Drashti stops again before the operator answers, it is not offered again.
      const kept = { ...saved, live: false, recording: false };
      try {
        writeFileSync(this.deps.stateFile, JSON.stringify(kept));
      } catch {
        // Offered this time anyway.
      }
      this.changed();
      return `Drashti stopped unexpectedly while ${what}, more than 5 minutes ago. Open the Stream panel to go live again.`;
    }
    const live = saved.live ? this.goLive() : null;
    const rec = saved.recording ? this.startRecording() : null;
    const failed = [live, rec].find((r): r is { ok: false; message: string } => r !== null && !r.ok);
    this.deps.log(
      'info',
      `After an unexpected stop ${Math.round(ago / 1000)} s ago, the stream (${what}) starts again by itself`,
    );
    if (failed) {
      this.deps.log('warn', `The stream could not start again by itself: ${failed.message}`);
      return `Drashti stopped unexpectedly while ${what}, and could not start again by itself: ${failed.message}`;
    }
    return `Drashti stopped unexpectedly while ${what}. It went ${saved.live ? 'live' : 'back to recording'} again by itself with the profile “${profile.name}”${saved.recording ? ', in a new recording file (the earlier one is kept and plays)' : ''}.`;
  }

  /** The operator answered the offer to go live again (or let it go). */
  /** Try again: the stream's page, stopped after crashing too often, starts afresh (open in Simple Mode). */
  tryAgainPage(): StreamResult {
    if (!this.pageStopped) return { ok: true, status: this.status() };
    this.pageStopped = false;
    this.pageRestarts.reset();
    this.deps.log('info', "The stream's page is tried again");
    this.updateProgram();
    this.changed();
    return { ok: true, status: this.status() };
  }

  dismissResume(): void {
    this.resume = null;
    this.changed();
  }

  /** Choose the folder recordings go into. */
  async pickFolder(parent: BrowserWindow | null): Promise<StreamResult> {
    const options: Electron.OpenDialogOptions = {
      title: 'Where should recordings go?',
      buttonLabel: 'Record here',
      properties: ['openDirectory', 'createDirectory'],
      ...(this.recording.folder ? { defaultPath: this.recording.folder } : {}),
    };
    const picked = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    const folder = picked.filePaths[0];
    if (picked.canceled || !folder) return { ok: true, status: this.status() };
    if (this.recording.state !== 'off')
      return { ok: false, message: 'Stop recording before choosing another folder.' };
    this.setRecordingFolder(folder);
    return { ok: true, status: this.status() };
  }

  /** Where recordings go (the operator chose it). */
  setRecordingFolder(folder: string): void {
    this.recording.folder = folder;
    this.deps.settings.set(FOLDER_SETTING, folder);
    this.changed();
  }

  /**
   * Drashti is going to quit (its quit was confirmed): from now on nothing opens the stream's page
   * again, or the new window would stop the quit and leave Drashti running unseen, on air (Session 23).
   */
  quitting(): void {
    this.closing = true;
  }

  /** Close everything (Drashti is quitting on purpose: the stream ends, and is not resumed). */
  close(): void {
    this.closing = true;
    if (this.liveWanted || this.recordWanted) {
      this.liveWanted = false;
      this.recordWanted = false;
      this.saveState();
    }
    this.worker?.send({ type: 'stop' });
    this.worker = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.program && !this.program.isDestroyed()) this.program.destroy();
    this.program = null;
  }
}
