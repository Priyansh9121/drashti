import { afterEach, expect, it, vi } from 'vitest';
import type { ProgramContext } from '../../../shared/stream';

const h = vi.hoisted(() => ({
  delay: vi.fn(),
  own: vi.fn(),
  input: vi.fn(() => Promise.resolve()),
  level: vi.fn(() => -100),
  pair: vi.fn(),
  stop: vi.fn(),
  speech: vi.fn<(port: unknown, track: () => unknown, graph: () => unknown) => void>(),
  list: vi.fn(() => Promise.resolve()),
  connected: vi.fn(),
  state: { context: null as ProgramContext | null, sound: 'on' },
  engineListener: null as ((view: { state: null; rev: number }) => void) | null,
}));
vi.mock('../program/sound', () => ({
  StreamSound: class {
    ctx = { state: 'running' };
    setDelay = h.delay;
    setOwnSound = h.own;
    useInput = h.input;
    level = h.level;
    track = () => 'generated mix track';
    inputTrack = () => 'generated raw input';
    speechGraph = () => 'generated raw graph';
  },
}));
vi.mock('../program/encoder-audio', () => ({
  EncoderAudio: class {
    pair = h.pair;
    stop = h.stop;
  },
}));
vi.mock('../program/speech-tap', () => ({ speechPort: h.speech }));
vi.mock('../program/camera', () => ({ listDevices: h.list }));
vi.mock('../program/program-store', () => ({
  useProgram: {
    getState: () => h.state,
    setState: (next: Partial<typeof h.state>) => Object.assign(h.state, next),
  },
}));
vi.mock('../engine/engine-store', () => ({
  connectEngine: h.connected,
  useEngine: {
    getState: () => ({ state: null }),
    subscribe: (listener: typeof h.engineListener) => {
      h.engineListener = listener;
    },
  },
}));
vi.mock('../render/clock', () => ({ holdClock: vi.fn() }));
vi.mock('../render/media-attempts', () => ({ watchGpuRestarts: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});

it('keeps the input, delay, raw captions tap, native encoder and four-reading peak meter together on the sound page', async () => {
  vi.useFakeTimers();
  const started = Date.now();
  let devicesReady = (): void => undefined;
  h.list.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      devicesReady = resolve;
    }),
  );
  const context = {
    sound: { id: 'generated', label: 'Generated input' },
    soundDelayMs: 250,
    mixOwnSound: true,
    capturing: true,
  } as ProgramContext;
  let contextChanged = (_next: ProgramContext): void => undefined;
  const page = Object.assign(new EventTarget(), {
    drashti: {
      output: { onTestClock: vi.fn() },
      stream: {
        page: {
          onContext: (listener: typeof contextChanged) => {
            contextChanged = listener;
          },
          context: () => Promise.resolve(context),
        },
      },
    },
  });
  vi.stubGlobal('window', page);
  vi.stubGlobal('navigator', { mediaDevices: new EventTarget() });
  const dataset = { bands: '-30,-40' } as Record<string, string>;
  vi.stubGlobal('document', { body: { dataset } });
  await import('./main');
  expect(h.input).not.toHaveBeenCalled();
  devicesReady();
  await vi.waitFor(() => expect(h.input).toHaveBeenCalledWith(context.sound));
  expect(h.delay).toHaveBeenCalledWith(250);
  expect(h.own).toHaveBeenCalledWith(true, null);
  expect(h.connected).toHaveBeenCalledWith('silent');
  const deliver = (role: string, port: unknown) => {
    const event = new Event('message');
    Object.defineProperties(event, {
      source: { value: page },
      data: { value: { drashtiStreamPort: role } },
      ports: { value: [port] },
    });
    page.dispatchEvent(event);
  };
  const native = { close: vi.fn() };
  deliver('encoder-audio', native);
  expect(h.pair).toHaveBeenCalledWith(native, 'generated mix track');
  const captions = { close: vi.fn() };
  deliver('speech', captions);
  expect(h.speech.mock.calls[0]?.[0]).toBe(captions);
  const tap = h.speech.mock.calls[0] as unknown as [unknown, () => unknown, () => unknown];
  expect(tap[1]()).toBe('generated raw input');
  expect(tap[2]()).toBe('generated raw graph');
  const meter = { close: vi.fn(), start: vi.fn(), postMessage: vi.fn() };
  deliver('sound-meter', meter);
  // Start a fresh four-reading window, avoiding any readings while the saved input was awaiting devices.
  await vi.advanceTimersByTimeAsync(100 - ((Date.now() - started) % 100));
  meter.postMessage.mockClear();
  h.level.mockReturnValueOnce(-20).mockReturnValueOnce(-5).mockReturnValueOnce(-10).mockReturnValueOnce(-30);
  await vi.advanceTimersByTimeAsync(100);
  expect(meter.postMessage).toHaveBeenCalledTimes(1);
  expect(meter.postMessage).toHaveBeenLastCalledWith({
    db: -5,
    audio: 'running',
    bands: '-30,-40',
    sound: 'on',
  });
  h.engineListener?.({ state: null, rev: 7 });
  expect(dataset['rev']).toBe('7');
  contextChanged({ ...context, capturing: false, sound: null });
  await vi.waitFor(() => expect(h.input).toHaveBeenLastCalledWith(null));
  expect(h.stop).toHaveBeenCalledOnce();
});
