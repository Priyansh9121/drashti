import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/*
 * Generated speech for caption AI's real recogniser (alpha.23, cap-realc): cap-winci's committed clips (synthetic
 * voices under a licence that allows them in a public repository, credited in the manifest; never real speech, a
 * recording or a microphone), put one after another into the one WAV file Chromium's fake microphone plays
 * (DRASHTI_TEST_FAKE_SOUND_FILE). Each clip's place in that file is known to the sample, so a test knows when each
 * one's speech ends relative to the file's first sample.
 */

/** cap-winci's set (CAP-CI-1 (b)): `manifest.json` beside the clips, their voices' licence in CREDITS.md. */
export const CLIPS_DIR = join(process.cwd(), 'tests', 'fixtures', 'captions');

export interface CaptionClip {
  id: string;
  language: string;
  /** What the voice says: the reference for a sanity bound on what is heard, never shown or logged by Drashti. */
  text: string;
  /** The same words written another way (a time in digits), as a recogniser may fairly write them. */
  also: string[];
  /** Its WAV file (16-bit PCM, one channel), absolute. */
  file: string;
}

/** The first `count` clips of one language, in the manifest's order. */
export function captionClips(language: string, count: number, dir = CLIPS_DIR): CaptionClip[] {
  const listed = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as unknown;
  const entries = Array.isArray(listed)
    ? listed
    : ((listed as { clips?: unknown } | null)?.clips as unknown[] | undefined);
  if (!Array.isArray(entries)) throw new Error(`${join(dir, 'manifest.json')} lists no clips`);
  const clips = entries.flatMap((e): CaptionClip[] => {
    const c = e as Partial<Record<keyof CaptionClip | 'text_digits', unknown>>;
    if (
      c.language !== language ||
      typeof c.id !== 'string' ||
      typeof c.text !== 'string' ||
      typeof c.file !== 'string'
    )
      return [];
    return [
      {
        id: c.id,
        language,
        text: c.text,
        also: typeof c.text_digits === 'string' ? [c.text_digits] : [],
        file: isAbsolute(c.file) ? c.file : resolve(dir, c.file),
      },
    ];
  });
  if (clips.length < count)
    throw new Error(
      `${String(clips.length)} ${language} clips in ${join(dir, 'manifest.json')}, not ${String(count)}`,
    );
  return clips.slice(0, count);
}

/** A WAV file's samples: 16-bit PCM, one channel, as the clips are made. */
export function readWav(file: string): { rate: number; samples: Int16Array } {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error(`${file} is not a WAV file`);
  let at = 12;
  let rate = 0;
  let data: Buffer | null = null;
  while (at + 8 <= b.length) {
    const id = b.toString('ascii', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    const body = b.subarray(at + 8, at + 8 + size);
    if (id === 'fmt ') {
      const format = body.readUInt16LE(0);
      const channels = body.readUInt16LE(2);
      const bits = body.readUInt16LE(14);
      if (format !== 1 || channels !== 1 || bits !== 16)
        throw new Error(
          `${file}: ${String(channels)} channel(s), ${String(bits)}-bit, format ${String(format)}`,
        );
      rate = body.readUInt32LE(4);
    } else if (id === 'data') data = body;
    at += 8 + size + (size % 2);
  }
  if (!rate || !data) throw new Error(`${file} has no sound`);
  const samples = new Int16Array(data.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2);
  return { rate, samples };
}

/**
 * Where the voice is in a clip (ms from its start): the first and last 20 ms with a level above -40 dBFS. The end is
 * the speech's end a viewer waits from; the clip's trailing silence does not count.
 */
export function speechSpan(samples: Int16Array, rate: number): { startMs: number; endMs: number } {
  const window = Math.max(1, Math.round(rate / 50));
  const floor = 32768 * 10 ** (-40 / 20);
  let first = -1;
  let last = -1;
  for (let w = 0; w * window < samples.length; w++) {
    let sum = 0;
    let n = 0;
    for (let i = w * window; i < Math.min(samples.length, (w + 1) * window); i++, n++)
      sum += (samples[i] ?? 0) ** 2;
    if (Math.sqrt(sum / Math.max(1, n)) < floor) continue;
    if (first < 0) first = w;
    last = w;
  }
  if (first < 0) throw new Error('A clip with no voice in it');
  return {
    startMs: ((first * window) / rate) * 1000,
    endMs: (Math.min(samples.length, (last + 1) * window) / rate) * 1000,
  };
}

/** A sound where the fake microphone's file holds it (ms from the file's first sample), and what it says. */
export interface PlacedSound {
  id: string;
  text: string;
  startMs: number;
  speechStartMs: number;
  speechEndMs: number;
  endMs: number;
}

/** A clip where the fake microphone's file holds it. */
export interface PlacedClip extends CaptionClip, PlacedSound {}

/** A 16-bit PCM, one-channel WAV file of these samples. */
function writeWav(out: string, rate: number, parts: readonly Int16Array[]): void {
  const length = parts.reduce((n, p) => n + p.length, 0);
  const data = Buffer.alloc(length * 2);
  let i = 0;
  for (const part of parts) for (const s of part) data.writeInt16LE(s, 2 * i++);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  writeFileSync(out, Buffer.concat([header, data]));
}

const chromiumPath = (out: string): void => {
  if (!isAbsolute(out) || out.includes('%'))
    throw new Error(`Chromium plays only an absolute path without '%': ${out}`);
};

/**
 * Generated tone bursts (no voice at all) for the generated test model, which always "hears" `text`: `leadMs` of
 * silence, then each burst (a 300 Hz tone at about -12 dBFS) and `gapMs` of silence after it, at 48 kHz.
 */
export function toneBurstsFile(
  out: string,
  o: { leadMs: number; gapMs: number; bursts: number; burstMs: number; text: string },
): PlacedSound[] {
  chromiumPath(out);
  const rate = 48_000;
  const silence = (ms: number) => new Int16Array(Math.round((ms / 1000) * rate));
  const burst = Int16Array.from({ length: Math.round((o.burstMs / 1000) * rate) }, (_, i) =>
    Math.round(8_000 * Math.sin((2 * Math.PI * 300 * i) / rate)),
  );
  const parts: Int16Array[] = [silence(o.leadMs)];
  const placed: PlacedSound[] = [];
  let at = o.leadMs;
  for (let n = 1; n <= o.bursts; n++) {
    placed.push({
      id: `burst-${String(n)}`,
      text: o.text,
      startMs: at,
      speechStartMs: at,
      speechEndMs: at + o.burstMs,
      endMs: at + o.burstMs,
    });
    parts.push(burst, silence(o.gapMs));
    at += o.burstMs + o.gapMs;
  }
  writeWav(out, rate, parts);
  return placed;
}

/**
 * The fake microphone's file: `leadMs` of silence (Route C starts listening in it), then each clip and `gapMs` of
 * silence after it (a phrase settles there), at the clips' one rate. A path Chromium can take (no '%').
 */
export function fakeMicrophoneFile(
  out: string,
  clips: readonly CaptionClip[],
  o: { leadMs: number; gapMs: number },
): PlacedClip[] {
  chromiumPath(out);
  const read = clips.map((c) => ({ clip: c, ...readWav(c.file) }));
  const rate = read[0]?.rate ?? 0;
  for (const r of read)
    if (r.rate !== rate)
      throw new Error(`${r.clip.id} is at ${String(r.rate)} Hz, the first at ${String(rate)}`);
  const ms = (n: number) => (n / rate) * 1000;
  const silence = (msLong: number) => new Int16Array(Math.round((msLong / 1000) * rate));
  const parts: Int16Array[] = [silence(o.leadMs)];
  let at = parts[0]?.length ?? 0;
  const placed: PlacedClip[] = [];
  for (const r of read) {
    const span = speechSpan(r.samples, rate);
    placed.push({
      ...r.clip,
      startMs: ms(at),
      speechStartMs: ms(at) + span.startMs,
      speechEndMs: ms(at) + span.endMs,
      endMs: ms(at + r.samples.length),
    });
    parts.push(r.samples, silence(o.gapMs));
    at += r.samples.length + (parts.at(-1)?.length ?? 0);
  }
  writeWav(out, rate, parts);
  return placed;
}

/** Text as compared: Unicode NFC, no punctuation or symbols, one space between words, lower case. */
export const plainText = (text: string): string =>
  text
    .normalize('NFC')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();

/** Character error rate of what was heard against what was said: edits over code points / the said text's length. */
export function characterErrorRate(said: string, heard: string): number {
  // Code points, as CER is counted for these scripts (a vowel sign is a character of its own).
  const a = Array.from(plainText(said));
  const b = Array.from(plainText(heard));
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return (row[b.length] ?? 0) / Math.max(1, a.length);
}
