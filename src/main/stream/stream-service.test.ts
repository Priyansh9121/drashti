import { soundWindowFixture } from './sound-window-fixture';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import type { ProgramContext } from '../../shared/stream';
import { type SecureStorage, StreamKeyStore } from './key-store';
import { StreamService, type MediaAccess, type StreamServiceDeps } from './stream-service';

vi.mock('electron', () => ({
  dialog: {},
  MessageChannelMain: class {
    port1 = Object.assign(new EventEmitter(), { close: vi.fn(), start: vi.fn() });
    port2 = {};
  },
}));

describe('the shared sound tap and Program', () => {
  it('keeps the camera closed for sound alone and publishes the chosen camera after permission for a picture', async () => {
    const send = vi.fn<(channel: string, context: ProgramContext) => void>();
    const webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      postMessage: vi.fn(),
      send,
    });
    const program = Object.assign(new EventEmitter(), {
      webContents,
      isDestroyed: () => false,
      getContentSize: () => [1920, 1080],
      destroy: vi.fn(),
    });
    const camera = { id: 'placeholder-camera', label: 'Placeholder camera' };
    const sound = { id: 'generated-sound', label: 'Generated sound' };
    const profile = { id: 'test-profile', preset: 'good', camera, sound };
    let cameraAccess: MediaAccess = 'not-determined';
    let grant = (_allowed: boolean): void => undefined;
    const answer = new Promise<boolean>((resolve) => {
      grant = resolve;
    });
    const ask = vi.fn(() => answer);
    const createProgram = vi.fn(() => program as unknown as BrowserWindow);
    const stream = new StreamService({
      profiles: { get: () => profile },
      settings: { get: (key: string) => (key === 'stream.profileId' ? profile.id : undefined) },
      screens: { streamGroup: () => null },
      createProgram,
      createStreamSound: soundWindowFixture,
      sendToOperator: vi.fn(),
      platform: 'darwin',
      mediaAccess: (kind: 'camera' | 'microphone') => (kind === 'camera' ? cameraAccess : 'granted'),
      askMediaAccess: ask,
      fakeDevices: false,
      ffmpegPath: () => null,
      now: Date.now,
      log: vi.fn(),
    } as unknown as StreamServiceDeps);
    const lastContext = () =>
      send.mock.calls.filter(([channel]) => channel === IPC.stream.context).at(-1)?.[1];
    const stop = stream.listenSound(vi.fn());
    expect(stop).not.toBeNull();
    await vi.waitFor(() => expect(createProgram).toHaveBeenCalledOnce());
    webContents.emit('did-finish-load');
    expect(stream.context()).toMatchObject({ camera: null, sound, picture: false, capturing: false });
    expect(ask).not.toHaveBeenCalled();

    stream.hold('window for a picture', true);
    expect(ask).toHaveBeenCalledOnce();
    expect(lastContext()).toMatchObject({ camera: null, sound, picture: true });
    cameraAccess = 'granted';
    grant(true);
    await vi.waitFor(() => expect(lastContext()).toMatchObject({ camera, sound, picture: true }));
    stop?.();
    stream.close();
  });
});

describe('the stream’s page without a graphics chip (Session 58, WU-1), or once the hall’s screens drew theirs (X21)', () => {
  it('its context says it draws without one once Main’s choice for its page says so, as an output’s does', async () => {
    const send = vi.fn<(channel: string, context: ProgramContext) => void>();
    const webContents = Object.assign(new EventEmitter(), {
      id: 41,
      isDestroyed: () => false,
      postMessage: vi.fn(),
      send,
    });
    const program = Object.assign(new EventEmitter(), {
      webContents,
      isDestroyed: () => false,
      getContentSize: () => [1920, 1080],
      destroy: vi.fn(),
    });
    const profile = { id: 'test-profile', preset: 'good', camera: null, sound: null };
    let skips = false;
    let warmedHere = false;
    const asked: number[] = [];
    const createProgram = vi.fn(() => program as unknown as BrowserWindow);
    const stream = new StreamService({
      profiles: { get: () => profile },
      settings: { get: (key: string) => (key === 'stream.profileId' ? profile.id : undefined) },
      screens: { streamGroup: () => null },
      createProgram,
      createStreamSound: soundWindowFixture,
      sendToOperator: vi.fn(),
      platform: 'darwin',
      mediaAccess: () => 'granted',
      askMediaAccess: () => Promise.resolve(true),
      fakeDevices: true,
      ffmpegPath: () => null,
      now: Date.now,
      log: vi.fn(),
      warmUpFact: (win: { webContents: { id: number } }) => {
        asked.push(win.webContents.id);
        return skips ? { noGpu: true } : warmedHere ? { warmedHere: true } : {};
      },
    } as unknown as StreamServiceDeps);
    stream.hold('a test of its page', true);
    await vi.waitFor(() => expect(createProgram).toHaveBeenCalledOnce());
    webContents.emit('did-finish-load');
    // Chromium has not said it draws without a chip: as before.
    expect(stream.context().noGpu).toBeUndefined();
    expect(stream.context().warmedHere).toBeUndefined();
    // A hall screen here drew its warm-up whole at this start (Session 60, X21): the page is told it needs none.
    warmedHere = true;
    expect(stream.context()).toMatchObject({ warmedHere: true });
    expect(stream.context().noGpu).toBeUndefined();
    skips = true;
    expect(stream.context()).toMatchObject({ noGpu: true });
    expect(asked).toContain(41);
    stream.close();
  });

  it('Main’s choice for its page is asked with whether the page draws a picture: not while open for sound alone (live captions), then for a picture (X21)', async () => {
    const webContents = Object.assign(new EventEmitter(), {
      id: 42,
      isDestroyed: () => false,
      postMessage: vi.fn(),
      send: vi.fn(),
    });
    const program = Object.assign(new EventEmitter(), {
      webContents,
      isDestroyed: () => false,
      getContentSize: () => [1920, 1080],
      destroy: vi.fn(),
    });
    const sound = { id: 'generated-sound', label: 'Generated sound' };
    const profile = { id: 'test-profile', preset: 'good', camera: null, sound };
    const asked: [number, boolean][] = [];
    const createProgram = vi.fn(() => program as unknown as BrowserWindow);
    const stream = new StreamService({
      profiles: { get: () => profile },
      settings: { get: (key: string) => (key === 'stream.profileId' ? profile.id : undefined) },
      screens: { streamGroup: () => null },
      createProgram,
      createStreamSound: soundWindowFixture,
      sendToOperator: vi.fn(),
      platform: 'darwin',
      mediaAccess: () => 'granted',
      askMediaAccess: () => Promise.resolve(true),
      fakeDevices: true,
      ffmpegPath: () => null,
      now: Date.now,
      log: vi.fn(),
      warmUpFact: (win: { webContents: { id: number } }, picture: boolean) => {
        asked.push([win.webContents.id, picture]);
        return {};
      },
    } as unknown as StreamServiceDeps);
    const stop = stream.listenSound(vi.fn());
    expect(stop).not.toBeNull();
    await vi.waitFor(() => expect(createProgram).toHaveBeenCalledOnce());
    webContents.emit('did-finish-load');
    expect(stream.context().picture).toBe(false);
    expect(asked.at(-1)).toEqual([42, false]);
    stream.hold('a test of its page', true);
    expect(stream.context().picture).toBe(true);
    expect(asked.at(-1)).toEqual([42, true]);
    stop?.();
    stream.close();
  });
});

// Q58-37 (the owner, 14 Nov 2026): opening Stream asked for the laptop's password, twice. Its panel's view is told
// whether keys can be kept without asking the system's secure storage (on a Mac, its keychain).
describe('the Stream panel’s profiles and keys', () => {
  it('are shown without asking the system’s secure storage', () => {
    let asked = 0;
    const storage: SecureStorage = {
      isEncryptionAvailable: () => {
        asked++;
        return true;
      },
      encryptString: (s) => {
        asked++;
        return Buffer.from(s);
      },
      decryptString: (b) => {
        asked++;
        return b.toString();
      },
    };
    const dir = mkdtempSync(join(tmpdir(), 'drashti-stream-keys-'));
    try {
      const profile = { id: 'test-profile', name: 'Placeholder profile', preset: 'good' };
      const stream = new StreamService({
        profiles: { get: () => profile, list: () => [profile] },
        settings: { get: () => profile.id },
        keys: new StreamKeyStore(join(dir, 'stream-keys.json'), storage),
        log: vi.fn(),
      } as unknown as StreamServiceDeps);
      expect(stream.profilesView()).toMatchObject({ activeId: profile.id, keyStorage: { available: true } });
      expect(asked).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('video out on the stream’s page (x30)', () => {
  it('keeps the page open while on, tells it in its context, gives it video out’s port only while on and ready, and lets it go', async () => {
    const send = vi.fn<(channel: string, context: ProgramContext) => void>();
    const webContents = Object.assign(new EventEmitter(), {
      id: 52,
      isDestroyed: () => false,
      postMessage: vi.fn(),
      send,
    });
    const program = Object.assign(new EventEmitter(), {
      webContents,
      isDestroyed: () => false,
      getContentSize: () => [1920, 1080],
      destroy: vi.fn(),
    });
    const profile = { id: 'test-profile', preset: 'good', camera: null, sound: null };
    const createProgram = vi.fn(() => program as unknown as BrowserWindow);
    const stream = new StreamService({
      profiles: { get: () => profile },
      settings: { get: (key: string) => (key === 'stream.profileId' ? profile.id : undefined) },
      screens: { streamGroup: () => null },
      createProgram,
      createStreamSound: soundWindowFixture,
      sendToOperator: vi.fn(),
      platform: 'darwin',
      mediaAccess: () => 'granted',
      askMediaAccess: () => Promise.resolve(true),
      fakeDevices: true,
      ffmpegPath: () => null,
      now: Date.now,
      log: vi.fn(),
    } as unknown as StreamServiceDeps);
    // Absent before x30: the red test fails here rather than at a type.
    const video = stream as unknown as {
      setVideoOut?: (on: boolean) => void;
      pairVideoOut?: (port: unknown) => boolean;
    };
    const port = { a: 'port' };
    const lastContext = () =>
      send.mock.calls.filter(([channel]) => channel === IPC.stream.context).at(-1)?.[1];
    // Off: never paired, nothing opened.
    expect(video.pairVideoOut?.(port) ?? false).toBe(false);
    expect(stream.context().videoOut).toBeUndefined();
    video.setVideoOut?.(true);
    await vi.waitFor(() => expect(createProgram).toHaveBeenCalledOnce());
    // Opening, not ready: not yet.
    expect(video.pairVideoOut?.(port)).toBe(false);
    webContents.emit('did-finish-load');
    expect(stream.context()).toMatchObject({
      videoOut: true,
      picture: true,
      capturing: false,
      preview: false,
    });
    expect(video.pairVideoOut?.(port)).toBe(true);
    expect(webContents.postMessage).toHaveBeenCalledWith(IPC.stream.port, { role: 'video-out' }, [port]);
    // Off while something else keeps the page (the window for Zoom): its context says so, and it stays.
    stream.hold('window for Zoom', true);
    video.setVideoOut?.(false);
    expect(lastContext()).toMatchObject({ picture: true });
    expect(lastContext()?.videoOut).toBeUndefined();
    expect(program.destroy).not.toHaveBeenCalled();
    expect(video.pairVideoOut?.(port)).toBe(false);
    // Nothing else wants it: the page closes.
    stream.hold('window for Zoom', false);
    expect(program.destroy).toHaveBeenCalledOnce();
    stream.close();
  });
});

// The lead (24 Nov, a22-cue): the stream's sound keeps its output awake (an inaudible constant) only while its sound is
// in use: live, recording, or heard by a sound tap (captions, sound recording); never for a page open only for its
// preview or video out, so an idle Drashti holds no sound output open (a Mac's sleep, laptops).
describe("the stream's sound in use", () => {
  it('is said in the pages context only while a sound tap listens (or the stream is live or recording), and told to them as it changes', async () => {
    const webContents = Object.assign(new EventEmitter(), {
      id: 43,
      isDestroyed: () => false,
      postMessage: vi.fn(),
      send: vi.fn(),
    });
    const program = Object.assign(new EventEmitter(), {
      webContents,
      isDestroyed: () => false,
      getContentSize: () => [1920, 1080],
      destroy: vi.fn(),
    });
    const sound = { id: 'generated-sound', label: 'Generated sound' };
    const profile = { id: 'test-profile', preset: 'good', camera: null, sound };
    const soundPages: BrowserWindow[] = [];
    const stream = new StreamService({
      profiles: { get: () => profile },
      settings: { get: (key: string) => (key === 'stream.profileId' ? profile.id : undefined) },
      screens: { streamGroup: () => null },
      createProgram: vi.fn(() => program as unknown as BrowserWindow),
      createStreamSound: () => {
        const win = soundWindowFixture();
        soundPages.push(win);
        return win;
      },
      sendToOperator: vi.fn(),
      platform: 'darwin',
      mediaAccess: () => 'granted',
      askMediaAccess: () => Promise.resolve(true),
      fakeDevices: true,
      ffmpegPath: () => null,
      now: Date.now,
      log: vi.fn(),
    } as unknown as StreamServiceDeps);
    const told = () =>
      (soundPages[0]?.webContents.send as ReturnType<typeof vi.fn> | undefined)?.mock.calls
        .filter(([channel]) => channel === IPC.stream.context)
        .at(-1)?.[1] as ProgramContext | undefined;
    // Open for its preview alone: nothing uses its sound.
    stream.hold('a preview of its page', true);
    await vi.waitFor(() => expect(soundPages).toHaveLength(1));
    webContents.emit('did-finish-load');
    await vi.waitFor(() => expect(told()).toBeDefined());
    expect(stream.context().soundInUse).toBeFalsy();
    expect(told()?.soundInUse).toBeFalsy();
    // A sound tap listens (live captions): in use, and the sound page is told.
    const stop = stream.listenSound(vi.fn());
    expect(stop).not.toBeNull();
    expect(stream.context().soundInUse).toBe(true);
    await vi.waitFor(() => expect(told()?.soundInUse).toBe(true));
    // It stops listening: not in use again, and told.
    stop?.();
    expect(stream.context().soundInUse).toBeFalsy();
    await vi.waitFor(() => expect(told()?.soundInUse).toBeFalsy());
    stream.hold('a preview of its page', false);
    stream.close();
  });
});
