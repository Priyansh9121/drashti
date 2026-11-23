import { basename } from 'node:path';
import type { HeardWord, SpeechLanguage } from '../../shared/speech';

export type IndicLanguage = 'gu' | 'hi';
export interface IndicFiles {
  model: string;
  tokens: string;
  frontend: string;
}
/** Structural subset of cap-pack's held PackedModel. The store owns hash verification and lifetime. */
export interface IndicPack {
  format: string;
  purposes: readonly string[];
  files: readonly { name: string; path: string }[];
}
export interface IndicReply {
  language: IndicLanguage;
  /** c: the helper's confidence in the word (the mean max posterior of its CTC frames, 0-1), or null without one. */
  words: { w: string; start: number; end: number; c: number | null }[];
}

export function pcmFrame(samples: Int16Array): Buffer {
  if (!samples.length || samples.length > 192_000) throw new Error('PCM bounds');
  const out = Buffer.allocUnsafe(4 + samples.length * 2);
  out.writeUInt32LE(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) out.writeInt16LE(samples[i] ?? 0, 4 + i * 2);
  return out;
}

export function routeCFiles(pack: IndicPack | null, language: SpeechLanguage | 'auto'): IndicFiles | null {
  if (language !== 'gu' && language !== 'hi') return null;
  if (
    pack?.format !== 'indicconformer-ctc-onnx-v1' ||
    pack.purposes.length !== 1 ||
    pack.purposes[0] !== `captions-${language}`
  )
    return null;
  const named = (name: string): string | null => {
    const matches = pack.files.filter((file) => basename(file.name.replaceAll('\\', '/')) === name);
    return matches.length === 1 ? (matches[0]?.path ?? null) : null;
  };
  const model = named('model.onnx'),
    tokens = named('tokens.txt'),
    frontend = named('frontend.bin');
  return model && tokens && frontend ? { model, tokens, frontend } : null;
}

export function parseIndicReply(value: unknown, language: IndicLanguage): IndicReply {
  const invalid = (): never => {
    throw new Error('Invalid recogniser reply');
  };
  if (
    typeof value !== 'object' ||
    value === null ||
    !('language' in value) ||
    value.language !== language ||
    !('words' in value) ||
    !Array.isArray(value.words) ||
    value.words.length > 1024 ||
    'error' in value
  )
    return invalid();
  const words: IndicReply['words'] = [];
  let bytes = 0;
  let previous = 0;
  for (const item of value.words as unknown[]) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('w' in item) ||
      typeof item.w !== 'string' ||
      !('start' in item) ||
      typeof item.start !== 'number' ||
      !('end' in item) ||
      typeof item.end !== 'number'
    )
      return invalid();
    // The word's confidence (cap-integration's helper): 0-1, or none at all (an older helper gives none).
    const c: unknown = 'c' in item ? item.c : null;
    if (c !== null && (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1)) return invalid();
    const w = item.w.normalize('NFC');
    bytes += Buffer.byteLength(w);
    const controls = Array.from(w).some((char) => {
      const point = char.codePointAt(0) ?? 0;
      return point < 0x20 || point === 0x7f || point === 0xfffd;
    });
    if (
      !w ||
      /\s/u.test(w) ||
      controls ||
      bytes > 4096 ||
      !Number.isFinite(item.start) ||
      !Number.isFinite(item.end) ||
      item.start < previous ||
      item.end < item.start ||
      item.end > 12.04
    )
      return invalid();
    // The tokenizer's unknown symbol is a decoder marker, never a word for the hall screen.
    const display = w.replaceAll('<unk>', '');
    if (display) words.push({ w: display, start: item.start, end: item.end, c });
    previous = item.start;
  }
  return { language, words };
}

/** 40 ms token frames are coarse timings; the model does not supply a confidence estimate. */
export function indicWords(
  value: unknown,
  language: IndicLanguage,
  startAt: number,
  endAt: number,
  captured?: (seconds: number, beginning: boolean) => number,
): HeardWord[] {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt)
    throw new Error('Invalid capture bounds');
  let previous = startAt;
  return parseIndicReply(value, language).words.map((word) => {
    const from = captured ? captured(word.start, true) : startAt + word.start * 1000;
    const to = captured ? captured(word.end, false) : startAt + word.end * 1000;
    const began = Math.min(endAt, Math.max(previous, from));
    const ended = Math.min(endAt, Math.max(began, to));
    previous = ended;
    return { text: word.w, startAt: began, endAt: ended, confidence: null };
  });
}

/**
 * Below this confidence a word of one syllable may be noise (the helper's mean top posterior over the word's CTC
 * frames). Measured on the int8 and full models (cap-integration, 24 Nov): generated noise and hum gave one-syllable
 * words at 0.06-0.40; synthetic short answers (હા, ના, જી, જય, છે, हाँ, जी, है, ना, जय) 0.56-1.00.
 */
export const NOISE_CONFIDENCE = 0.5;

/** One syllable: one letter or digit, with its vowel signs and marks (હ, છે, है, हाँ). */
const oneSyllable = (word: string): boolean => (word.match(/[\p{L}\p{N}]/gu)?.length ?? 0) <= 1;

/**
 * A phrase Route C made out of noise or hum (cap-route-c: generated noise and hum give one-syllable "words" such as
 * હ, છે, म, है, આ; silence gives none): every word one syllable AND heard with low confidence. A short answer heard
 * clearly (હા, जी) is speech, and without the helper's confidence nothing is called noise.
 */
export function noiseOnly(words: readonly { w: string; c: number | null }[]): boolean {
  return (
    words.length > 0 &&
    words.every((word) => word.c !== null && word.c < NOISE_CONFIDENCE && oneSyllable(word.w))
  );
}
