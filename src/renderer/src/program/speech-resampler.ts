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
