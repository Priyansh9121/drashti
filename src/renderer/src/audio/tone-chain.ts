import { type Tone, TONE_EASE_S, toneFilters } from '../../../shared/playback-settings';

/*
 * A sound's tone (alpha.20, Sound and picture…: Bass, Treble, Voice boost), heard alike in the hall (audio/main.ts) and
 * on the stream (program/sound.ts): four filters in a line between a sound's source and its level, eased with
 * setTargetAtTime so a change never clicks and never stops or moves the sound. A sound whose file never had a tone has
 * no filters at all; the stream's own sound input (the microphones) never goes through one.
 */

export class ToneChain {
  private readonly filters: BiquadFilterNode[];

  constructor(private readonly ctx: BaseAudioContext) {
    this.filters = toneFilters(null).map((f) => {
      const node = ctx.createBiquadFilter();
      node.type = f.type;
      node.frequency.value = f.frequency;
      node.gain.value = f.gain;
      if (f.q > 0) node.Q.value = f.q;
      return node;
    });
    for (let i = 1; i < this.filters.length; i++) {
      const from = this.filters[i - 1];
      const to = this.filters[i];
      if (from && to) from.connect(to);
    }
  }

  get input(): AudioNode {
    return this.filters[0] as AudioNode;
  }

  get output(): AudioNode {
    return this.filters[this.filters.length - 1] as AudioNode;
  }

  /** Ease every filter to this tone (none: flat, the sound as it is). */
  set(tone: Tone | null): void {
    const at = this.ctx.currentTime;
    toneFilters(tone).forEach((f, i) => {
      const node = this.filters[i];
      if (!node) return;
      node.frequency.setTargetAtTime(f.frequency, at, TONE_EASE_S);
      node.gain.setTargetAtTime(f.gain, at, TONE_EASE_S);
    });
  }

  disconnect(): void {
    for (const f of this.filters) f.disconnect();
  }
}

/**
 * A sound's way from its source to its level with its tone: a sound that has never had one stays joined straight to
 * its level (no filters); the first tone puts the filters between them, eased from flat; later ones ease there. The
 * chain (null while it has none).
 */
export function toneThrough(
  ctx: BaseAudioContext,
  source: AudioNode,
  level: AudioNode,
  chain: ToneChain | null,
  tone: Tone | null,
): ToneChain | null {
  if (chain) {
    chain.set(tone);
    return chain;
  }
  if (!tone) return null;
  const made = new ToneChain(ctx);
  made.output.connect(level);
  source.connect(made.input);
  source.disconnect(level);
  made.set(tone);
  return made;
}

/** The two bands the tests' meter reads (Hz): a low one under the bass shelf, a high one over the treble shelf. */
export const METER_BANDS = { low: [40, 62], high: [7200, 8800] } as const;

/** The loudest bin of a band of a spectrum (dB, rounded), -200 for none: for the meter's data-bands. */
export function bandDb(
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number,
  band: readonly [number, number],
): number {
  const binHz = sampleRate / fftSize;
  let loudest = -Infinity;
  const last = Math.min(spectrum.length - 1, Math.ceil(band[1] / binHz));
  for (let i = Math.max(0, Math.floor(band[0] / binHz)); i <= last; i++)
    loudest = Math.max(loudest, spectrum[i] ?? -Infinity);
  return Number.isFinite(loudest) ? Math.round(loudest) : -200;
}

/** An analyser's two bands now, as the meter writes them: "low,high" in dB. */
export function bandsText(meter: AnalyserNode, spectrum: Float32Array<ArrayBuffer>): string {
  meter.getFloatFrequencyData(spectrum);
  const { sampleRate } = meter.context;
  return `${String(bandDb(spectrum, sampleRate, meter.fftSize, METER_BANDS.low))},${String(
    bandDb(spectrum, sampleRate, meter.fftSize, METER_BANDS.high),
  )}`;
}
