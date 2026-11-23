import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { StreamService, type StreamServiceDeps } from './stream-service';

vi.mock('electron', () => ({
  dialog: {},
  MessageChannelMain: class {
    port1 = Object.assign(new EventEmitter(), { close: vi.fn(), start: vi.fn() });
    port2 = {};
  },
}));

function page(id: number) {
  let destroyed = false;
  const win = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), {
      id,
      isDestroyed: () => destroyed,
      postMessage: vi.fn<(channel: string, payload: { role: string }, ports: unknown[]) => void>(),
      send: vi.fn(),
    }),
    isDestroyed: () => destroyed,
    getContentSize: () => [1920, 1080],
    destroy: vi.fn(() => {
      destroyed = true;
      win.emit('closed');
    }),
  });
  return win;
}

function setup() {
  const picture = page(101),
    sound = page(102);
  const createProgram = vi.fn(() => picture as unknown as BrowserWindow);
  const createStreamSound = vi.fn(() => sound as unknown as BrowserWindow);
  const profile = {
    id: 'placeholder',
    preset: 'good',
    camera: null,
    sound: { id: 'generated-input', label: 'Generated input' },
    mixOwnSound: true,
    soundDelayMs: 250,
  };
  const service = new StreamService({
    profiles: { get: () => profile },
    settings: { get: () => profile.id },
    screens: { streamGroup: () => null },
    createProgram,
    createStreamSound,
    sendToOperator: vi.fn(),
    platform: 'win32',
    fakeDevices: true,
    ffmpegPath: () => null,
    now: Date.now,
    log: vi.fn(),
  } as unknown as StreamServiceDeps);
  return { service, picture, sound, createStreamSound };
}

describe('the stream sound renderer', () => {
  it('owns audio and captions ports while the picture page is blocked loading or decoding', async () => {
    const { service, picture, sound, createStreamSound } = setup();
    try {
      service.hold('generated picture decode', true);
      const stop = service.listenSound(vi.fn());
      await vi.waitFor(() => expect(createStreamSound).toHaveBeenCalledOnce());
      // No picture did-finish-load: its media work must never gate sound's port or seek landing.
      const worker = { sendFrames: vi.fn(), stop: vi.fn() };
      (service as unknown as { worker: unknown }).worker = worker;
      sound.webContents.emit('did-finish-load');
      const roles = () => sound.webContents.postMessage.mock.calls.map((c) => c[1]?.role);
      expect(roles()).toContain('encoder-audio');
      expect(roles()).toContain('speech');
      expect(picture.webContents.postMessage).not.toHaveBeenCalled();
      // Loading the picture later gives it only picture ports, never sound players' work.
      picture.webContents.emit('did-finish-load');
      expect(picture.webContents.postMessage.mock.calls.map((c) => c[1]?.role)).toContain('encoder');
      expect(picture.webContents.postMessage.mock.calls.map((c) => c[1]?.role)).not.toContain(
        'encoder-audio',
      );
      expect(picture.webContents.postMessage.mock.calls.map((c) => c[1]?.role)).not.toContain('speech');
      stop?.();
      (service as unknown as { worker: unknown }).worker = null;
    } finally {
      service.close();
    }
  });
});
