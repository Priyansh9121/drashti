import { expect, it, vi } from 'vitest';
import { EncoderAudio } from './encoder-audio';

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
