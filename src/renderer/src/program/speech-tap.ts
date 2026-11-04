/*
 * The stream's sound input for live captions (Session 55, Part 10): the input's own sound (before the stream's delay,
 * its mix with Drashti's own sound and its limiter), mono, 16 kHz, 16-bit, sent to the main process on its own port
 * about ten times a second. The page never hears a word: it only passes the sound on.
 */

export const SPEECH_RATE = 16_000;

/** Mono samples at any rate to 16 kHz 16-bit: each output sample the average of the input it stands for. */
export class SpeechResampler {
  /** Where the next output sample falls in the next piece's input. */
  private at = 0;

  push(input: Float32Array, rate: number): Int16Array {
    const step = rate / SPEECH_RATE;
    const out: number[] = [];
    while (this.at < input.length) {
      const from = Math.max(0, Math.floor(this.at - step / 2));
      const to = Math.min(input.length, Math.max(from + 1, Math.ceil(this.at + step / 2)));
      let sum = 0;
      for (let i = from; i < to; i += 1) sum += input[i] ?? 0;
      const v = Math.max(-1, Math.min(1, sum / (to - from)));
      out.push(Math.round(v * 32_767));
      this.at += step;
    }
    this.at -= input.length;
    return Int16Array.from(out);
  }
}

let port: MessagePort | null = null;
let reader: ReadableStreamDefaultReader<AudioData> | null = null;
let trackOf: () => MediaStreamTrack | null = () => null;
let retry: ReturnType<typeof setTimeout> | null = null;
/** The port now (read through a function: speechPort() changes it while a piece is awaited). */
const portNow = (): MessagePort | null => port;

/** Read the input's sound while the port is open; a new input (or none yet) is looked for again each second. */
async function read(): Promise<void> {
  if (!port || reader) return;
  const track = trackOf();
  if (!track || track.readyState === 'ended') {
    // eslint-disable-next-line no-restricted-syntax -- live captions' sound: the input looked for again each second, never a frame of the picture
    retry ??= setTimeout(() => {
      retry = null;
      void read();
    }, 1_000);
    return;
  }
  const mine = new MediaStreamTrackProcessor<AudioData>({ track }).readable.getReader();
  reader = mine;
  const resampler = new SpeechResampler();
  let waiting: Int16Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const { value: data, done } = await mine.read();
      if (done) break;
      const frames = data.numberOfFrames;
      const mono = new Float32Array(frames);
      const plane = new Float32Array(frames);
      const channels = Math.max(1, data.numberOfChannels);
      for (let c = 0; c < channels; c += 1) {
        data.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
        for (let i = 0; i < frames; i += 1) mono[i] = (mono[i] ?? 0) + (plane[i] ?? 0) / channels;
      }
      const rate = data.sampleRate;
      data.close();
      const piece = resampler.push(mono, rate);
      waiting.push(piece);
      count += piece.length;
      // About a tenth of a second at a time.
      const to = portNow();
      if (count >= SPEECH_RATE / 10 && to) {
        const all = new Int16Array(count);
        let at = 0;
        for (const part of waiting) {
          all.set(part, at);
          at += part.length;
        }
        to.postMessage({ kind: 'pcm', samples: all.buffer }, [all.buffer]);
        waiting = [];
        count = 0;
      }
    }
  } catch {
    // The input went (another chosen, or none): looked for again below.
  } finally {
    if (reader === mine) reader = null;
  }
  if (portNow()) void read();
}

/** The main process gave the page a port for live captions (null: it closed it). */
export function speechPort(next: MessagePort | null, track: () => MediaStreamTrack | null): void {
  port?.close();
  port = next;
  trackOf = track;
  if (!port) {
    void reader?.cancel();
    reader = null;
    return;
  }
  port.start();
  void read();
}
