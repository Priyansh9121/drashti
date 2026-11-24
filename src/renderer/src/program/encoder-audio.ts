/** The audio source is transferred to its worker's native queue, independently of drawing or video-buffer copies. */
export class EncoderAudio {
  private worker: Worker | null = null;
  private track: MediaStreamTrack | null = null;

  constructor(
    private readonly failed: () => void,
    private readonly makeWorker: () => Worker = () =>
      new Worker(new URL('./encoder-audio-worker.ts', import.meta.url), {
        type: 'module',
        name: 'Drashti stream sound',
      }),
    private readonly sourceOf: (track: MediaStreamTrack) => ReadableStream<AudioData> = (track) =>
      new MediaStreamTrackProcessor<AudioData>({ track }).readable,
  ) {}

  pair(port: MessagePort, track: MediaStreamTrack | null): void {
    if (this.worker && this.track === track && track?.readyState === 'live') {
      this.worker.postMessage({ type: 'pair', port }, [port]);
      return;
    }
    this.stop();
    if (!track) {
      port.close();
      return;
    }
    let worker: Worker | null = null;
    let source: ReadableStream<AudioData> | null = null;
    try {
      worker = this.makeWorker();
      source = this.sourceOf(track);
      const active = worker;
      this.worker = active;
      this.track = track;
      const fail = () => {
        active.terminate();
        if (this.worker !== active) return;
        this.worker = null;
        this.track = null;
        this.failed();
      };
      active.addEventListener('error', fail);
      active.addEventListener('message', (event: MessageEvent<{ type?: string }>) => {
        if (event.data.type === 'stopped') {
          active.terminate();
          return;
        }
        if (event.data.type === 'failed' || event.data.type === 'ended') fail();
      });
      active.postMessage({ type: 'start', port, source }, [port, source]);
    } catch {
      worker?.terminate();
      if (source && !source.locked) void source.cancel().catch(() => undefined);
      if (this.worker === worker) {
        this.worker = null;
        this.track = null;
      }
      port.close();
      this.failed();
    }
  }

  stop(): void {
    const worker = this.worker;
    this.worker = null;
    this.track = null;
    worker?.postMessage({ type: 'stop' });
  }
}
