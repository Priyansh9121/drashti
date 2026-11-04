import { SPEECH_RATE, SpeechResampler } from './speech-resampler';

// AudioWorkletGlobalScope is separate from Window; TypeScript's DOM library does not describe its processor API.
declare const sampleRate: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

/** Only raw mono sound crosses the port, in 100 ms batches. The branch itself always outputs silence. */
class SpeechProcessor extends AudioWorkletProcessor {
  private readonly resampler = new SpeechResampler();
  private mono = new Float32Array(128);
  private batch = new Int16Array(SPEECH_RATE / 10);
  private count = 0;
  private stopped = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === 'stop') this.stopped = true;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    for (const channel of outputs[0] ?? []) channel.fill(0);
    if (this.stopped) return false;
    const channels = inputs[0];
    const frames = channels?.[0]?.length ?? 0;
    if (!channels?.length || !frames) return true;
    if (this.mono.length !== frames) this.mono = new Float32Array(frames);
    this.mono.fill(0);
    for (const channel of channels)
      for (let i = 0; i < frames; i += 1)
        this.mono[i] = (this.mono[i] ?? 0) + (channel[i] ?? 0) / channels.length;
    const samples = this.resampler.push(this.mono, sampleRate);
    for (const sample of samples) {
      this.batch[this.count++] = sample;
      if (this.count === this.batch.length) {
        this.port.postMessage(this.batch, [this.batch.buffer]);
        this.batch = new Int16Array(SPEECH_RATE / 10);
        this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor('drashti-speech', SpeechProcessor);
