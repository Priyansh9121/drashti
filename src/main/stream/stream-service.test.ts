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

describe('the stream’s page without a graphics chip (Session 58, WU-1)', () => {
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
    const asked: number[] = [];
    const createProgram = vi.fn(() => program as unknown as BrowserWindow);
    const stream = new StreamService({
      profiles: { get: () => profile },
      settings: { get: (key: string) => (key === 'stream.profileId' ? profile.id : undefined) },
      screens: { streamGroup: () => null },
      createProgram,
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
        return skips ? { noGpu: true } : {};
      },
    } as unknown as StreamServiceDeps);
    stream.hold('a test of its page', true);
    await vi.waitFor(() => expect(createProgram).toHaveBeenCalledOnce());
    webContents.emit('did-finish-load');
    // Chromium has not said it draws without a chip: as before.
    expect(stream.context().noGpu).toBeUndefined();
    skips = true;
    expect(stream.context()).toMatchObject({ noGpu: true });
    expect(asked).toContain(41);
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
