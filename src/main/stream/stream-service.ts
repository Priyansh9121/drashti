import { type BrowserWindow, dialog, MessageChannelMain, type WebContents } from 'electron';
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
  StreamProfiles,
  StreamProfilesResult,
  StreamResult,
  StreamStatus,
} from '../../shared/stream';
import { STREAM_PRESETS } from '../../shared/stream';
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
import type { StreamKeyStore } from './key-store';

/*
 * The stream (PLAN.md 4.2), as the main process keeps it: the profiles and
 * their keys, the layout, the Program window (open only while something
 * needs it: the operator's preview, going live or recording), and what the
 * stream's page reports about its camera and sound input.
 */

export type MediaAccess = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

export interface StreamServiceDeps {
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
  /** The screen groups changed (the stream group was made): Screens shows it. */
  screensChanged(): void;
  /** Tests: Chromium's fake camera and microphone stand in, and the system is not asked. */
  fakeDevices: boolean;
  log(level: 'info' | 'warn', message: string): void;
}

const PROFILE_SETTING = 'stream.profileId';
const LAYOUT_SETTING = 'stream.layout';
const FOLDER_SETTING = 'stream.recordingFolder';

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
  private readonly watchers = new Map<number, WebContents>();
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
  };
  private encoder: string | null = null;
  private ffmpeg: StreamStatus['ffmpeg'] = { available: false, version: null };

  constructor(private readonly deps: StreamServiceDeps) {
    const saved = streamLayoutSchema.safeParse(deps.settings.get(LAYOUT_SETTING));
    this.layout = saved.success ? saved.data : 'camera';
    const folder = z.string().safeParse(deps.settings.get(FOLDER_SETTING));
    this.recording.folder = folder.success ? folder.data : null;
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

  profilesView(): StreamProfiles {
    const active = this.activeProfile();
    return { profiles: this.deps.profiles.list(), activeId: active.id, keyStorage: this.deps.keys.status() };
  }

  /** On air or recording: the profile in use and its inputs stay as they are. */
  inUse(): boolean {
    return this.live.state !== 'off' || this.recording.state !== 'off';
  }

  saveProfile(rawId: unknown, rawInput: unknown): StreamProfilesResult {
    const input = streamProfileInputSchema.safeParse(rawInput);
    if (!input.success)
      return { ok: false, message: input.error.issues[0]?.message ?? 'Check the profile’s settings.' };
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
    }
    this.contextChanged();
    return { ok: true, profiles: this.profilesView() };
  }

  /** While on air, the camera, sound and delay may change; where it goes and how may not. */
  private liveSettingsChanged(
    before: StreamProfile,
    after: StreamProfile | Omit<StreamProfile, 'id' | 'hasKey'>,
  ): boolean {
    return before.url !== after.url || before.preset !== after.preset;
  }

  removeProfile(rawId: unknown): StreamProfilesResult {
    const id = z.string().max(100).safeParse(rawId);
    if (!id.success || !this.deps.profiles.get(id.data))
      return { ok: false, message: 'That profile no longer exists.' };
    if (this.inUse() && id.data === this.activeProfile().id)
      return { ok: false, message: 'This profile is in use: end the stream and stop recording first.' };
    if (this.deps.profiles.list().length <= 1) return { ok: false, message: 'Keep at least one profile.' };
    this.deps.profiles.remove(id.data);
    this.deps.keys.remove(id.data);
    this.contextChanged();
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
    return { ok: true, profiles: this.profilesView() };
  }

  setKey(rawId: unknown, rawKey: unknown): StreamProfilesResult {
    const id = z.string().max(100).safeParse(rawId);
    if (!id.success || !this.deps.profiles.get(id.data))
      return { ok: false, message: 'That profile no longer exists.' };
    const key = streamKeySchema.safeParse(rawKey);
    if (!key.success)
      return { ok: false, message: 'Paste the stream key from YouTube Studio: letters, digits and dashes.' };
    const kept = this.deps.keys.set(id.data, key.data);
    if (!kept.ok) return kept;
    this.deps.log('info', 'A stream key was saved');
    this.changed();
    return { ok: true, profiles: this.profilesView() };
  }

  removeKey(rawId: unknown): StreamProfilesResult {
    const id = z.string().max(100).safeParse(rawId);
    if (!id.success || !this.deps.profiles.get(id.data))
      return { ok: false, message: 'That profile no longer exists.' };
    this.deps.keys.remove(id.data);
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
    const made = this.deps.screens.streamGroup() === null;
    const group = this.deps.screens.ensureStreamGroup();
    if (made) this.deps.screensChanged();
    return {
      layout: this.layout,
      languages: group.languages,
      width: preset.width,
      height: preset.height,
      camera: this.systemBlocked.camera ? null : profile.camera,
      sound: this.systemBlocked.microphone ? null : profile.sound,
      soundDelayMs: profile.soundDelayMs,
      mixOwnSound: profile.mixOwnSound,
      capturing: this.live.state !== 'off' || this.recording.state !== 'off',
      preview: this.watchers.size > 0,
    };
  }

  isProgram(contents: WebContents | null): boolean {
    return (
      contents !== null &&
      this.program !== null &&
      !this.program.isDestroyed() &&
      contents.id === this.program.webContents.id
    );
  }

  /** The Program window is open while the preview is watched, or the stream is live or recording. */
  private updateProgram(): void {
    const wanted = this.watchers.size > 0 || this.inUse();
    if (wanted && (!this.program || this.program.isDestroyed())) {
      void this.openProgram();
    } else if (!wanted && this.program && !this.program.isDestroyed()) {
      this.program.destroy();
      this.program = null;
      this.programReady = false;
      this.inputs = NO_INPUTS;
      this.changed();
    }
  }

  private async openProgram(): Promise<void> {
    await this.checkSystemAccess();
    if (this.program && !this.program.isDestroyed()) return;
    const { width, height } = this.context();
    const win = this.deps.createProgram({ width, height });
    this.program = win;
    this.programReady = false;
    win.webContents.on('did-finish-load', () => {
      this.programReady = true;
      this.pairPreviews();
      this.changed();
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      this.deps.log('warn', `The stream's page stopped (${details.reason}); starting it again`);
      this.programReady = false;
      if (!win.isDestroyed()) win.destroy();
      if (this.program === win) this.program = null;
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
    if (!program || program.isDestroyed() || !this.programReady) return;
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
    if (program && !program.isDestroyed() && this.programReady) {
      const context = this.context();
      const [w, h] = program.getContentSize();
      if (w !== context.width || h !== context.height) program.setContentSize(context.width, context.height);
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
      inputs: {
        ...this.inputs,
        camera: this.systemBlocked.camera ? 'blocked' : this.inputs.camera,
        sound: this.systemBlocked.microphone ? 'blocked' : this.inputs.sound,
        message: this.inputsMessage(),
      },
      live: { ...this.live },
      recording: { ...this.recording, file: this.recording.file ? basename(this.recording.file) : null },
      encoder: this.encoder,
      keyStorage: this.deps.keys.status(),
      ffmpeg: { ...this.ffmpeg },
    };
  }

  private changed(): void {
    this.deps.sendToOperator(IPC.stream.changed, this.status());
  }

  // ---- going live and recording (step 2) -----------------------------------------------

  goLive(): StreamResult {
    return { ok: false, message: 'Going live is not ready yet.' };
  }

  end(): StreamResult {
    return { ok: false, message: 'The stream is not on air.' };
  }

  startRecording(): StreamResult {
    return { ok: false, message: 'Recording is not ready yet.' };
  }

  stopRecording(): StreamResult {
    return { ok: false, message: 'Nothing is being recorded.' };
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
    this.recording.folder = folder;
    this.deps.settings.set(FOLDER_SETTING, folder);
    this.changed();
    return { ok: true, status: this.status() };
  }

  /** Close everything (Drashti is quitting). */
  close(): void {
    if (this.program && !this.program.isDestroyed()) this.program.destroy();
    this.program = null;
  }
}
