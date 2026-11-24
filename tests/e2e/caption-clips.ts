import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

/*
 * Generated sound for Route C inside Drashti (alpha.23, cap-realc): the one WAV file Chromium's fake microphone plays
 * (DRASHTI_TEST_FAKE_SOUND_FILE), with each sound's place in it known to the sample, so a test knows when each one
 * ends relative to the file's first sample. Generated tones only in this release (no voice, no recording, no
 * microphone); the clips of generated speech and their real-model spec come with the next release.
 */

/** A sound where the fake microphone's file holds it (ms from the file's first sample), and what it says. */
export interface PlacedSound {
  id: string;
  text: string;
  startMs: number;
  speechStartMs: number;
  speechEndMs: number;
  endMs: number;
}

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

/** Text as compared: Unicode NFC, no punctuation or symbols, one space between words, lower case. */
export const plainText = (text: string): string =>
  text
    .normalize('NFC')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
