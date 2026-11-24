import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import type { BrowserWindow, WebContents } from 'electron';
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

function setup(more: Record<string, unknown> = {}) {
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
    ...more,
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
      const roles = () => sound.webContents.postMessage.mock.calls.map((c) => c[1].role);
      expect(roles()).toContain('encoder-audio');
      expect(roles()).toContain('speech');
      expect(picture.webContents.postMessage).not.toHaveBeenCalled();
      // Loading the picture later gives it only picture ports, never sound players' work.
      picture.webContents.emit('did-finish-load');
      expect(picture.webContents.postMessage.mock.calls.map((c) => c[1].role)).toContain('encoder');
      expect(picture.webContents.postMessage.mock.calls.map((c) => c[1].role)).not.toContain('encoder-audio');
      expect(picture.webContents.postMessage.mock.calls.map((c) => c[1].role)).not.toContain('speech');
      expect(
        roles().filter((role) => role === 'encoder-audio'),
        'loading pictures leaves the working sound port alone',
      ).toHaveLength(1);
      picture.webContents.emit('did-finish-load');
      expect(
        roles().filter((role) => role === 'encoder-audio'),
        'reloading pictures repairs only picture ports',
      ).toHaveLength(1);
      stop?.();
    } finally {
      (service as unknown as { worker: unknown }).worker = null;
      service.close();
    }
  });

  it('recovers sound ports after a sound renderer crash without replacing the encoder or the picture page', async () => {
    const { service, picture, sound, createStreamSound } = setup();
    const replacement = page(103);
    const worker = { sendFrames: vi.fn(), send: vi.fn() };
    try {
      service.hold('generated picture decode', true);
      const stop = service.listenSound(vi.fn());
      await vi.waitFor(() => expect(createStreamSound).toHaveBeenCalledOnce());
      (service as unknown as { worker: unknown }).worker = worker;
      picture.webContents.emit('did-finish-load');
      sound.webContents.emit('did-finish-load');
      const picturePorts = picture.webContents.postMessage.mock.calls.filter(
        (c) => c[1].role === 'encoder',
      ).length;
      createStreamSound.mockReturnValue(replacement as unknown as BrowserWindow);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      sound.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
      await vi.advanceTimersByTimeAsync(500);
      expect(createStreamSound).toHaveBeenCalledTimes(2);
      replacement.webContents.emit('did-finish-load');
      expect(replacement.webContents.postMessage.mock.calls.map((c) => c[1].role)).toEqual(
        expect.arrayContaining(['encoder-audio', 'speech', 'sound-meter']),
      );
      expect(picture.destroy).not.toHaveBeenCalled();
      expect(picture.webContents.postMessage.mock.calls.filter((c) => c[1].role === 'encoder')).toHaveLength(
        picturePorts,
      );
      expect(worker.send).not.toHaveBeenCalled();
      stop?.();
    } finally {
      (service as unknown as { worker: unknown }).worker = null;
      service.close();
      vi.useRealTimers();
    }
  });

  it('merges camera and microphone reports only from their owners, preserving the other input', async () => {
    const { service, picture, sound, createStreamSound } = setup();
    try {
      service.hold('generated picture', true);
      await vi.waitFor(() => expect(createStreamSound).toHaveBeenCalledOnce());
      picture.webContents.emit('did-finish-load');
      sound.webContents.emit('did-finish-load');
      const camera = { id: 'camera-in-picture-session', label: 'Generated camera' };
      const microphone = { id: 'microphone-in-sound-session', label: 'Generated input' };
      service.reportInputs(picture.webContents as unknown as WebContents, {
        cameras: [camera],
        microphones: [],
        camera: 'on',
        sound: 'none',
        message: null,
      });
      service.reportInputs(sound.webContents as unknown as WebContents, {
        cameras: [],
        microphones: [microphone],
        camera: 'none',
        sound: 'on',
        message: null,
      });
      expect(service.status().inputs).toMatchObject({
        cameras: [camera],
        microphones: [microphone],
        camera: 'on',
        sound: 'on',
      });
      service.reportInputs(picture.webContents as unknown as WebContents, {
        cameras: [camera],
        microphones: [],
        camera: 'on',
        sound: 'missing',
        message: null,
      });
      expect(service.status().inputs.sound).toBe('on');
      const outsider = page(104);
      service.reportInputs(outsider.webContents as unknown as WebContents, {
        cameras: [],
        microphones: [],
        camera: 'none',
        sound: 'missing',
        message: null,
      });
      expect(service.status().inputs).toMatchObject({ camera: 'on', sound: 'on' });
    } finally {
      service.close();
    }
  });

  it('caps repeated sound crashes, keeps the picture, and restarts sound only after Try again', async () => {
    const { service, picture, sound, createStreamSound } = setup();
    const windows = [sound];
    createStreamSound.mockImplementation(() => {
      const next =
        windows.length === 1 && createStreamSound.mock.calls.length === 1
          ? sound
          : page(102 + windows.length);
      if (next !== sound) windows.push(next);
      return next as unknown as BrowserWindow;
    });
    try {
      service.hold('generated picture', true);
      await vi.waitFor(() => expect(createStreamSound).toHaveBeenCalledOnce());
      picture.webContents.emit('did-finish-load');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      for (let crash = 0; crash < 6; crash++) {
        windows.at(-1)?.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
        await vi.advanceTimersByTimeAsync(500);
      }
      expect(createStreamSound).toHaveBeenCalledTimes(6);
      expect(service.status()).toMatchObject({ pageStopped: false, soundPageStopped: true });
      expect(picture.destroy).not.toHaveBeenCalled();
      service.tryAgainPage();
      await vi.advanceTimersByTimeAsync(0);
      expect(createStreamSound).toHaveBeenCalledTimes(7);
      expect(service.status().soundPageStopped).toBeUndefined();
    } finally {
      service.close();
      vi.useRealTimers();
    }
  });

  it('says at the cap that the stream’s sound has stopped, never that its sound input would not start (a22-review-x86 S2)', async () => {
    // The sixth crash in a minute stops the stream's sound page, not the microphone. The Stream panel's sentence, the
    // No sound notice and Record sound's refusal said "The sound input “…” would not start." and sent the operator to
    // the mixer and its cable in the middle of a show; each now points to Try again. Try again starts the page afresh.
    const { service, picture, createStreamSound } = setup({
      settings: { get: (key: string) => (key === 'stream.recordingFolder' ? tmpdir() : 'placeholder') },
    });
    const windows: ReturnType<typeof page>[] = [];
    createStreamSound.mockImplementation(() => {
      const next = page(300 + windows.length);
      windows.push(next);
      return next as unknown as BrowserWindow;
    });
    const noSoundMessage = (why: 'input' | 'quiet') =>
      (
        service as unknown as { noSoundMessage: (n: { since: number; why: 'input' | 'quiet' }) => string }
      ).noSoundMessage({ since: 0, why });
    try {
      service.hold('generated picture', true);
      await vi.waitFor(() => expect(createStreamSound).toHaveBeenCalledOnce());
      picture.webContents.emit('did-finish-load');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      for (let crash = 0; crash < 6; crash++) {
        windows.at(-1)?.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
        await vi.advanceTimersByTimeAsync(500);
      }
      expect(service.status().soundPageStopped).toBe(true);
      const stopped = 'The stream’s sound has stopped. Press Try again.';
      expect(service.status().inputs.message, 'the Stream panel').toBe(stopped);
      expect(noSoundMessage('input'), 'No sound, the input known to give nothing').toBe(
        `${stopped} Until then the stream has no sound.`,
      );
      expect(noSoundMessage('quiet'), 'No sound, quiet for its 20 s').toBe(
        `${stopped} Until then the stream has no sound.`,
      );
      expect(service.startSoundRecording(), 'Record sound').toEqual({
        ok: false,
        message: 'The stream’s sound has stopped. Press Try again before recording sound.',
      });
      service.tryAgainPage();
      expect(service.status().soundPageStopped).toBeUndefined();
      expect(service.status().inputs, 'Try again: the sound page starts afresh').toMatchObject({
        sound: 'starting',
        message: null,
      });
    } finally {
      service.close();
      vi.useRealTimers();
    }
  });

  it('tells Main each time the sound page goes, so a waiting cue never waits on a page that is gone (a22-review-x86 S1)', async () => {
    // A cue's pages are worked out again when a page joins; a sound page that crashed for the sixth time (or closed)
    // has no successor to join, and a playlist's automatic crossfade waited on it for ever, the hall's next video
    // with it. Main asks the engine again each time this says so (index.ts: videoCuePageJoined('')).
    const soundChanged = vi.fn();
    const { service, picture, createStreamSound } = setup({ soundChanged });
    const windows: ReturnType<typeof page>[] = [];
    createStreamSound.mockImplementation(() => {
      const next = page(200 + windows.length);
      windows.push(next);
      return next as unknown as BrowserWindow;
    });
    try {
      service.hold('generated picture', true);
      await vi.waitFor(() => expect(createStreamSound).toHaveBeenCalledOnce());
      picture.webContents.emit('did-finish-load');
      windows[0]?.webContents.emit('did-finish-load');
      expect(soundChanged).not.toHaveBeenCalled();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      windows.at(-1)?.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
      expect(soundChanged, 'a crash: the page is gone at once').toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(500);
      for (let crash = 1; crash < 6; crash++) {
        windows.at(-1)?.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
        await vi.advanceTimersByTimeAsync(500);
      }
      expect(service.status().soundPageStopped).toBe(true);
      expect(soundChanged, 'the sixth: stopped, with no page left to wait for').toHaveBeenCalledTimes(6);
      service.tryAgainPage();
      await vi.advanceTimersByTimeAsync(0);
      expect(createStreamSound).toHaveBeenCalledTimes(7);
      service.hold('generated picture', false);
      expect(soundChanged, 'nothing needs it any more: it closes').toHaveBeenCalledTimes(7);
    } finally {
      service.close();
      vi.useRealTimers();
    }
  });
});
