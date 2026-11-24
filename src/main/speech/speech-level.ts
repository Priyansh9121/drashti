import type { CaptionTiming } from '../../shared/captions';

/**
 * How loud sound must be to count as speech (alpha.22's speech level): at least `least` (16-bit RMS) and `over` times
 * the noise floor learnt as it goes. Standard is what captions always used (about 38 dB below full scale, and about
 * 10 dB over the noise); a quiet room hears speech 6 dB softer, a noisy hall asks for it 6 dB louder.
 */
const SPEECH_LEVELS: Readonly<Record<CaptionTiming['speech'], { least: number; over: number }>> =
  Object.freeze({
    standard: { least: 400, over: 3 },
    'quiet-room': { least: 200, over: 2 },
    'noisy-hall': { least: 800, over: 4 },
  });

/** Whether a chunk of this level is speech, over a noise floor of `floor`. */
export function isSpeech(level: number, floor: number, speech: CaptionTiming['speech']): boolean {
  const { least, over } = SPEECH_LEVELS[speech];
  return level > Math.max(least, floor * over);
}
