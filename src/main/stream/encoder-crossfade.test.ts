import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { expect, it, vi } from 'vitest';
import { StreamService, type StreamServiceDeps } from './stream-service';

/*
 * QA23-FADE-9, item 3 (the owner: "Try fixes, keep held (Rec.)"): while a crossfade is on in the show, the stream
 * worker's encoder runs at normal priority (./worker/pipeline.ts setCrossfade); Main tells the worker each change once,
 * and a worker started during one is told at its start.
 */

vi.mock('electron', () => ({
  dialog: {},
  MessageChannelMain: class {
    port1 = Object.assign(new EventEmitter(), { close: vi.fn(), start: vi.fn() });
    port2 = {};
  },
}));

function page(id: number) {
  const win = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), {
      id,
      isDestroyed: () => false,
      postMessage: vi.fn(),
      send: vi.fn(),
    }),
    isDestroyed: () => false,
    getContentSize: () => [1920, 1080],
    destroy: vi.fn(),
  });
  return win as unknown as BrowserWindow;
}

function worker() {
  return { send: vi.fn(), sendFrames: vi.fn(), onMessage: vi.fn(), onExit: vi.fn(), kill: vi.fn() };
}

function setup(spawned = worker()) {
  const profile = {
    id: 'placeholder',
    preset: 'good',
    camera: null,
    sound: null,
    mixOwnSound: true,
    soundDelayMs: 0,
  };
  const service = new StreamService({
    profiles: { get: () => profile },
    settings: { get: () => profile.id },
    screens: { streamGroup: () => null },
    createProgram: () => page(101),
    createStreamSound: () => page(102),
    spawnWorker: () => spawned,
    sendToOperator: vi.fn(),
    platform: 'win32',
    fakeDevices: true,
    ffmpegPath: () => null,
    now: Date.now,
    log: vi.fn(),
  } as unknown as StreamServiceDeps);
  return service;
}

it('tells the running worker when a crossfade begins and ends, each change once', () => {
  const service = setup();
  const running = worker();
  (service as unknown as { worker: unknown }).worker = running;
  try {
    service.setCrossfade(true);
    service.setCrossfade(true);
    expect(running.send.mock.calls).toEqual([[{ type: 'crossfade', on: true }]]);
    service.setCrossfade(false);
    service.setCrossfade(false);
    expect(running.send.mock.calls).toEqual([
      [{ type: 'crossfade', on: true }],
      [{ type: 'crossfade', on: false }],
    ]);
  } finally {
    (service as unknown as { worker: unknown }).worker = null;
    service.close();
  }
});

it('tells a worker started during a crossfade at its start, and one started outside it nothing', () => {
  const spawned = worker();
  const service = setup(spawned);
  try {
    service.setCrossfade(true);
    (service as unknown as { ensureWorker: (ffmpeg: string) => unknown }).ensureWorker('generated-ffmpeg');
    const types = spawned.send.mock.calls.map((c) => (c[0] as { type: string; on?: boolean }).type);
    expect(types[0]).toBe('start');
    expect(spawned.send).toHaveBeenCalledWith({ type: 'crossfade', on: true });
  } finally {
    (service as unknown as { worker: unknown }).worker = null;
    service.close();
  }
  const quiet = worker();
  const other = setup(quiet);
  try {
    (other as unknown as { ensureWorker: (ffmpeg: string) => unknown }).ensureWorker('generated-ffmpeg');
    expect(quiet.send.mock.calls.filter((c) => (c[0] as { type: string }).type === 'crossfade')).toEqual([]);
  } finally {
    (other as unknown as { worker: unknown }).worker = null;
    other.close();
  }
});
