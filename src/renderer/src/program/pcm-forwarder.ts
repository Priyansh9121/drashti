export type PcmPort = Pick<MessagePort, 'postMessage' | 'close'>;
export type PcmResult = 'ended' | 'stopped' | 'failed';

/** One native audio source; a repaired encoder changes only its destination, never restarts the sound. */
export class PcmForwarder {
  readonly done: Promise<PcmResult>;
  private readonly reader: ReadableStreamDefaultReader<AudioData>;
  private port: PcmPort | null;
  private stopped = false;

  constructor(source: ReadableStream<AudioData>, port: PcmPort) {
    this.reader = source.getReader();
    this.port = port;
    this.done = this.run();
  }

  pair(port: PcmPort): void {
    if (this.stopped) {
      port.close();
      return;
    }
    if (this.port === port) return;
    this.port?.close();
    this.port = port;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.port?.close();
    this.port = null;
    void this.reader.cancel().catch(() => undefined);
  }

  private async run(): Promise<PcmResult> {
    try {
      for (;;) {
        const { value: data, done } = await this.reader.read();
        if (done) {
          return this.stopped ? 'stopped' : 'ended';
        }
        try {
          if (this.stopped) {
            return 'stopped';
          }
          const frames = data.numberOfFrames;
          const out = new Float32Array(frames * 2);
          if (data.numberOfChannels >= 2 && data.format === 'f32') data.copyTo(out, { planeIndex: 0 });
          else {
            const plane = new Float32Array(frames);
            for (let channel = 0; channel < 2; channel++) {
              data.copyTo(plane, {
                planeIndex: Math.min(channel, data.numberOfChannels - 1),
                format: 'f32-planar',
              });
              for (let index = 0; index < frames; index++) out[index * 2 + channel] = plane[index] ?? 0;
            }
          }
          // Electron's native port must clone this bounded PCM packet: a transferred buffer arrives empty.
          this.port?.postMessage({ kind: 'audio', data: out.buffer, frames });
        } finally {
          data.close();
        }
      }
    } catch {
      return this.stopped ? 'stopped' : 'failed';
    } finally {
      this.stopped = true;
      this.port?.close();
      this.port = null;
      await this.reader.cancel().catch(() => undefined);
      this.reader.releaseLock();
    }
  }
}
