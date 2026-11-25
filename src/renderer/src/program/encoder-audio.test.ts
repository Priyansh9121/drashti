import { afterEach, expect, it, vi } from 'vitest';
import { STREAM_SOUND_QUIET_MS } from '../../../shared/stream';
import { EncoderAudio } from './encoder-audio';

afterEach(() => {
  vi.unstubAllGlobals();
});

class SoundWorker extends EventTarget {
  readonly sent: { message: { type: string }; transfer?: Transferable[] }[] = [];
  readonly terminate = vi.fn();
  postMessage(message: { type: string }, transfer?: Transferable[]): void {
    this.sent.push({ message, transfer });
  }
  worker(): Worker {
    return this as unknown as Worker;
  }
}
it('transfers the audio source once, repairs only its port, and disposes the worker after stop acknowledgement', () => {
  const worker = new SoundWorker(),
    source = new ReadableStream<AudioData>();
  const make = vi.fn(() => worker.worker()),
    read = vi.fn(() => source),
    failed = vi.fn();
  const capture = new EncoderAudio(failed, make, read);
  const track = { readyState: 'live' } as MediaStreamTrack;
  const first = { close: vi.fn() } as unknown as MessagePort,
    next = { close: vi.fn() } as unknown as MessagePort;
  capture.pair(first, track);
  capture.pair(next, track);
  expect(make).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(1);
  expect(worker.sent.map((s) => s.message.type)).toEqual(['start', 'pair']);
  expect(worker.sent[0]?.transfer).toEqual([first, source]);
  expect(worker.sent[1]?.transfer).toEqual([next]);
  capture.stop();
  expect(worker.sent.at(-1)?.message.type).toBe('stop');
  worker.dispatchEvent(new MessageEvent('message', { data: { type: 'stopped' } }));
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(failed).not.toHaveBeenCalled();
});

// a22-fadeskip (run 45513574785's retry): Chromium's capture queue keeps 10 chunks of 10 ms by default and drops the
// oldest when its reader is held up: a PCM worker that did not run for 335 ms lost about 230 ms of the stream's sound.
it('asks Chromium to hold, for a PCM worker that is held up, as much sound as the encoder waits for before silence', () => {
  const asked: unknown[] = [];
  class Processor {
    readonly readable = new ReadableStream<AudioData>();
    constructor(init: unknown) {
      asked.push(init);
    }
  }
  vi.stubGlobal('MediaStreamTrackProcessor', Processor);
  const worker = new SoundWorker();
  const capture = new EncoderAudio(vi.fn(), () => worker.worker());
  const track = { readyState: 'live' } as MediaStreamTrack;
  capture.pair({ close: vi.fn() } as unknown as MessagePort, track);
  // Chromium hands Web Audio's sound on in chunks of 10 ms.
  expect(asked).toEqual([{ track, maxBufferSize: STREAM_SOUND_QUIET_MS / 10 }]);
  expect(worker.sent[0]?.message.type).toBe('start');
});
