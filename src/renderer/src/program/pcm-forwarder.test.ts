import { expect, it, vi } from 'vitest';
import { PcmForwarder, type PcmPort } from './pcm-forwarder';

class Samples {
  readonly numberOfFrames: number;
  readonly numberOfChannels: number;
  readonly close = vi.fn();
  constructor(
    readonly channels: number[][],
    readonly format: AudioSampleFormat = 'f32-planar',
  ) {
    this.numberOfFrames = channels[0]?.length ?? 0;
    this.numberOfChannels = channels.length;
  }
  copyTo(out: Float32Array, options: { planeIndex: number; format?: AudioSampleFormat }): void {
    if (this.format === 'f32' && options.format === undefined) {
      for (let i = 0; i < this.numberOfFrames; i++)
        for (let channel = 0; channel < this.numberOfChannels; channel++)
          out[i * this.numberOfChannels + channel] = this.channels[channel]?.[i] ?? 0;
    } else out.set(this.channels[options.planeIndex] ?? []);
  }
  data(): AudioData {
    return this as unknown as AudioData;
  }
}
function source() {
  let controller!: ReadableStreamDefaultController<AudioData>;
  const cancelled = vi.fn();
  const stream = new ReadableStream<AudioData>({
    start: (value) => {
      controller = value;
    },
    cancel: cancelled,
  });
  return {
    stream,
    cancelled,
    enqueue: (sample: Samples) => controller.enqueue(sample.data()),
    end: () => controller.close(),
    fail: () => controller.error(new Error('Generated source failure')),
  };
}
function port(events: string[] = [], label = 'port') {
  const packets: { frames: number; data: ArrayBuffer }[] = [];
  let resolve!: () => void;
  const delivered = new Promise<void>((done) => {
    resolve = done;
  });
  const close = vi.fn(() => {
    events.push(`${label} closed`);
  });
  const endpoint: PcmPort = {
    close,
    postMessage: (value: unknown) => {
      events.push(`${label} packet`);
      packets.push(value as { frames: number; data: ArrayBuffer });
      resolve();
    },
  };
  return { endpoint, packets, close, delivered };
}

it('keeps the exact stereo float samples and frame count, closes the source frame and releases the reader', async () => {
  const input = source(),
    output = port(),
    data = new Samples(
      [
        [0.25, -0.5],
        [0.75, -1],
      ],
      'f32',
    );
  const pump = new PcmForwarder(input.stream, output.endpoint);
  input.enqueue(data);
  await output.delivered;
  expect(output.packets[0]?.frames).toBe(2);
  expect([...new Float32Array(output.packets[0]?.data ?? new ArrayBuffer(0))]).toEqual([
    0.25, 0.75, -0.5, -1,
  ]);
  expect(data.close).toHaveBeenCalledTimes(1);
  pump.stop();
  expect(await pump.done).toBe('stopped');
  expect(output.close).toHaveBeenCalledTimes(1);
  expect(input.stream.locked).toBe(false);
});
it('duplicates mono to both channels and closes a naturally ended destination exactly once', async () => {
  const input = source(),
    output = port();
  const pump = new PcmForwarder(input.stream, output.endpoint);
  input.enqueue(new Samples([[0.25, -0.5]]));
  input.end();
  expect(await pump.done).toBe('ended');
  expect([...new Float32Array(output.packets[0]?.data ?? new ArrayBuffer(0))]).toEqual([
    0.25, 0.25, -0.5, -0.5,
  ]);
  expect(output.close).toHaveBeenCalledTimes(1);
  expect(input.stream.locked).toBe(false);
});
it('closes the old native port before a repaired port receives PCM, without restarting its source', async () => {
  const events: string[] = [],
    input = source(),
    old = port(events, 'old'),
    next = port(events, 'next');
  const pump = new PcmForwarder(input.stream, old.endpoint);
  input.enqueue(new Samples([[0.25], [0.5]]));
  await old.delivered;
  pump.pair(next.endpoint);
  expect(old.close).toHaveBeenCalledTimes(1);
  expect(input.cancelled).not.toHaveBeenCalled();
  input.enqueue(new Samples([[0.75], [1]]));
  await next.delivered;
  expect(events.indexOf('old closed')).toBeLessThan(events.indexOf('next packet'));
  expect(old.packets).toHaveLength(1);
  expect([...new Float32Array(next.packets[0]?.data ?? new ArrayBuffer(0))]).toEqual([0.75, 1]);
  pump.stop();
  expect(await pump.done).toBe('stopped');
  expect(next.close).toHaveBeenCalledTimes(1);
  expect(input.stream.locked).toBe(false);
});
it('closes an already delivered frame after Stop without sending stale PCM or leaking a late paired port', async () => {
  const input = source(),
    output = port(),
    data = new Samples([[1], [1]]),
    late = port();
  const pump = new PcmForwarder(input.stream, output.endpoint);
  input.enqueue(data);
  pump.stop();
  pump.pair(late.endpoint);
  expect(await pump.done).toBe('stopped');
  expect(output.packets).toHaveLength(0);
  expect(data.close).toHaveBeenCalledTimes(1);
  expect(output.close).toHaveBeenCalledTimes(1);
  expect(late.close).toHaveBeenCalledTimes(1);
});
it('closes the port and reader when its native source fails', async () => {
  const input = source(),
    output = port();
  const pump = new PcmForwarder(input.stream, output.endpoint);
  input.fail();
  expect(await pump.done).toBe('failed');
  expect(output.close).toHaveBeenCalledTimes(1);
  expect(input.stream.locked).toBe(false);
});
