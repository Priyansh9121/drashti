import { createHash } from 'node:crypto';
import {
  createReadStream,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isLanguageModelLanguage, type LanguageModelLanguage } from '../../shared/captions';
import { fileProblem } from '../plain-errors';
import { freeBytesOf } from '../stream/recording-drive';

/*
 * A captions model of its own per language (alpha.22, cap-whisper; x80's design): a whisper.cpp ggml file made for
 * Gujarati, Hindi or English, used instead of the general model when the speaker's language is set to it. Drashti
 * knows each one by its exact size and SHA-256 (the list below) and uses no other file: an admin adds the file from
 * this computer's drive (File › Live Captions…), it is checked whole, copied into the data folder
 * (speech-models/languages/, never the library, a backup or the installers), checked again, and stamped. Before each
 * use its size and time are compared with the stamp; a file changed since it was checked is refused, never used.
 * Nothing here downloads anything.
 */

export interface LanguageModelEntry {
  /** Its name in the data folder: lower-case letters, digits, dots, dashes and underscores. */
  id: string;
  language: LanguageModelLanguage;
  /** What the dialog calls it. */
  name: string;
  bytes: number;
  sha256: string;
  /** Its weights' licence, as approved (free and open only). */
  licence: string;
  /** Whether a failed piece is tried again warmer (whisper's fallback), as for the general models. */
  fallback: boolean;
  /** Whether it is decoded with timestamps: false for a model trained without them (the vasista22 tunes). */
  timestamps: boolean;
  /**
   * Its format in the model pack, when it is not whisper.cpp's ('whisper-ggml', left out): Route C's IndicConformer
   * ('indicconformer-ctc-onnx-v1', its SHA-256 the model.onnx file's).
   */
  format?: CaptionModelFormat;
}

/** The formats a caption route runs: Route W's whisper.cpp files and Route C's IndicConformer (ONNX Runtime). */
export const CAPTION_MODEL_FORMATS = ['whisper-ggml', 'indicconformer-ctc-onnx-v1'] as const;
export type CaptionModelFormat = (typeof CAPTION_MODEL_FORMATS)[number];
const isCaptionModelFormat = (value: unknown): value is CaptionModelFormat =>
  CAPTION_MODEL_FORMATS.some((format) => format === value);

/**
 * The language models Drashti knows, each by its file's exact bytes and SHA-256. Since alpha.22: the Gujarati (small
 * and medium) and Hindi (small) fine-tunes of Whisper by vasista22 (Speech Lab, IIT Madras; Apache-2.0 on OpenAI's MIT
 * base), converted to ggml by whisper.cpp's own converter and quantized by its own quantizer (cap-route-w, 23 Nov
 * 2026; ledger N/reports/cap-downloads-ledger.md; the q5_1 files are byte for byte Ukta's published ones). They were
 * trained without timestamps. Gujarati without temperature fallback: with it the small model fell behind on 24 of 40
 * clips, without it on none (cap-route-w's round 2). Which of them ships is decided by the real-speech numbers; a
 * language with none chosen is heard by the general model, as before.
 */
const KNOWN: LanguageModelEntry[] = [
  {
    id: 'gu-small-vasista22-f16',
    language: 'gu',
    name: 'Gujarati tuned, small (full size)',
    bytes: 487_601_967,
    sha256: '4352740b11928eef0743477d0729c3abda01c3f95f2e7802ad771beeeeb45c7a',
    licence: 'Apache-2.0 (base model MIT)',
    fallback: false,
    timestamps: false,
  },
  {
    id: 'gu-small-vasista22-q8_0',
    language: 'gu',
    name: 'Gujarati tuned, small (8-bit)',
    bytes: 264_464_607,
    sha256: '44927c4860080a0122d6eac5d42a12b3b1e30c56d3bdeddc3850456bc303d215',
    licence: 'Apache-2.0 (base model MIT)',
    fallback: false,
    timestamps: false,
  },
  {
    id: 'gu-small-vasista22-q5_1',
    language: 'gu',
    name: 'Gujarati tuned, small (5-bit, q5_1)',
    bytes: 190_085_487,
    sha256: 'e756347b8fb573b88a5625ad98dac9075746549fdf407260d321d077a73b094a',
    licence: 'Apache-2.0 (base model MIT)',
    fallback: false,
    timestamps: false,
  },
  {
    id: 'gu-small-vasista22-q5_0',
    language: 'gu',
    name: 'Gujarati tuned, small (5-bit, q5_0)',
    bytes: 175_209_663,
    sha256: '608a61708e73fd529025500487f77089909b05ad8966455314c6124cb272ecac',
    licence: 'Apache-2.0 (base model MIT)',
    fallback: false,
    timestamps: false,
  },
  {
    id: 'gu-medium-vasista22-f16',
    language: 'gu',
    name: 'Gujarati tuned, medium (full size)',
    bytes: 1_533_763_059,
    sha256: '591ddaff1202b383c53be6aa2b9cc8278a169f17e4f583ac57032a059282671f',
    licence: 'Apache-2.0 (base model MIT)',
    fallback: false,
    timestamps: false,
  },
  {
    id: 'gu-medium-vasista22-q8_0',
    language: 'gu',
    name: 'Gujarati tuned, medium (8-bit)',
    bytes: 823_369_779,
    sha256: 'f1468ff2d0f69265feda6db834803919385e3f69885775ffd2aa40644e84157c',
    licence: 'Apache-2.0 (base model MIT)',
    fallback: false,
    timestamps: false,
  },
  {
    id: 'gu-medium-vasista22-q5_0',
    language: 'gu',
    name: 'Gujarati tuned, medium (5-bit)',
    bytes: 539_212_467,
    sha256: '0d539e6d025489e1412453f28852b46d806682b11afcefbee9e5aa1010375f5c',
    licence: 'Apache-2.0 (base model MIT)',
    fallback: false,
    timestamps: false,
  },
  {
    id: 'hi-small-vasista22-f16',
    language: 'hi',
    name: 'Hindi tuned, small (full size)',
    bytes: 487_601_967,
    sha256: '5d9f25596aad22c9a8a67de67632b5e8f0d1e43b26cdd0f26c1d628d7e953e91',
    licence: 'Apache-2.0 (base model MIT)',
    fallback: true,
    timestamps: false,
  },
  {
    id: 'hi-small-vasista22-q8_0',
    language: 'hi',
    name: 'Hindi tuned, small (8-bit)',
    bytes: 264_464_607,
    sha256: '0b2ff62094c004b0b180f47d6cb4aefec12d4d93ad3282058aa022827eb721e5',
    licence: 'Apache-2.0 (base model MIT)',
    fallback: true,
    timestamps: false,
  },
  {
    id: 'hi-small-vasista22-q5_1',
    language: 'hi',
    name: 'Hindi tuned, small (5-bit, q5_1)',
    bytes: 190_085_487,
    sha256: '6813fed7ffa6c3fa14490c1f1788d2d8b6e3b7badf59a2f75fb4c5c21cf00f3f',
    licence: 'Apache-2.0 (base model MIT)',
    fallback: true,
    timestamps: false,
  },
  {
    id: 'hi-small-vasista22-q5_0',
    language: 'hi',
    name: 'Hindi tuned, small (5-bit, q5_0)',
    bytes: 175_209_663,
    sha256: '8d436e4bcceae1e5021df902d7db87c130ee7cf4810dbd6fa8edd8038595f33e',
    licence: 'Apache-2.0 (base model MIT)',
    fallback: true,
    timestamps: false,
  }, // Route C (alpha.22): AI4Bharat's IndicConformer (120M, CTC head, MIT) exported to ONNX by cap-route-c and run by
  // Drashti's helper on ONNX Runtime 1.23.2; known by the pack's model.onnx (its tokens and frontend files come with
  // it in the pack). The 8-bit copies hear real Gujarati as well as the full ones at 40% of the size (cap-route-c).
  // Whisper's fallback and timestamps do not apply (Route C gives each phrase its own times).
  {
    id: 'gu-indicconformer-ctc-int8',
    language: 'gu',
    name: 'Gujarati IndicConformer (8-bit)',
    bytes: 197_297_864,
    sha256: '52d70bb2b311e9acf44fa868f5f75c3ab21e49885ed89f77ade4c2f011a32307',
    licence: 'MIT',
    fallback: false,
    timestamps: false,
    format: 'indicconformer-ctc-onnx-v1',
  },
  {
    id: 'hi-indicconformer-ctc-int8',
    language: 'hi',
    name: 'Hindi IndicConformer (8-bit)',
    bytes: 197_297_864,
    sha256: '02ef118807cbf4eda797cebab30703757ec920e328acdcf067227220ef0afeed',
    licence: 'MIT',
    fallback: false,
    timestamps: false,
    format: 'indicconformer-ctc-onnx-v1',
  },
  {
    id: 'gu-indicconformer-ctc',
    language: 'gu',
    name: 'Gujarati IndicConformer',
    bytes: 493_034_563,
    sha256: '7f5e83cd55d7832d671db1c9bd9299ea37cea6e5f8b79d2981fecb7c58537766',
    licence: 'MIT',
    fallback: false,
    timestamps: false,
    format: 'indicconformer-ctc-onnx-v1',
  },
  {
    id: 'hi-indicconformer-ctc',
    language: 'hi',
    name: 'Hindi IndicConformer',
    bytes: 493_034_563,
    sha256: 'fdeb04da4f5a9abc0b4a6f0d3900848776629331c23d64a92ddd466bddb3ecf0',
    licence: 'MIT',
    fallback: false,
    timestamps: false,
    format: 'indicconformer-ctc-onnx-v1',
  },
];

export const LANGUAGE_MODELS: readonly LanguageModelEntry[] = Object.freeze(
  KNOWN.map((entry) => Object.freeze(entry)),
);

export class LanguageModelRefused extends Error {}

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

/** A list of entries as written (the built-in list, or a test's): each checked; a repeated id or file is dropped. */
export function parseLanguageModelList(raw: unknown): LanguageModelEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: LanguageModelEntry[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const e = item as Record<string, unknown>;
    const { id, language, name, bytes, sha256, licence, fallback } = e;
    const timestamps = e['timestamps'] ?? true;
    const format = e['format'];
    if (format !== undefined && !isCaptionModelFormat(format)) continue;
    if (
      typeof id !== 'string' ||
      !ID.test(id) ||
      !isLanguageModelLanguage(language) ||
      typeof name !== 'string' ||
      name.trim() === '' ||
      typeof bytes !== 'number' ||
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      typeof sha256 !== 'string' ||
      !SHA256.test(sha256) ||
      typeof licence !== 'string' ||
      licence.trim() === '' ||
      typeof fallback !== 'boolean' ||
      typeof timestamps !== 'boolean'
    )
      continue;
    if (out.some((o) => o.id === id || o.sha256 === sha256)) continue;
    out.push({
      id,
      language,
      name,
      bytes,
      sha256,
      licence,
      fallback,
      timestamps,
      ...(format ? { format } : {}),
    });
  }
  return out;
}

/** Where a language model is kept on this computer. */
export function languageModelFile(userData: string, id: string): string {
  return join(userData, 'speech-models', 'languages', `${id}.bin`);
}

const LANGUAGE_NAMES: Readonly<Record<LanguageModelLanguage, string>> = Object.freeze({
  gu: 'Gujarati',
  hi: 'Hindi',
  en: 'English',
});

export const languageName = (language: LanguageModelLanguage): string => LANGUAGE_NAMES[language];

/** The stamp beside a checked file: what was checked, and the file's size and time then. */
interface Stamp {
  sha256: string;
  bytes: number;
  mtimeMs: number;
}

const stampFile = (file: string): string => `${file}.check`;

function readStamp(file: string): Stamp | null {
  try {
    const raw = JSON.parse(readFileSync(stampFile(file), 'utf8')) as Partial<Stamp>;
    return typeof raw.sha256 === 'string' && typeof raw.bytes === 'number' && typeof raw.mtimeMs === 'number'
      ? { sha256: raw.sha256, bytes: raw.bytes, mtimeMs: raw.mtimeMs }
      : null;
  } catch {
    return null;
  }
}

function writeStamp(file: string, sha256: string): void {
  const s = statSync(file);
  const stamp: Stamp = { sha256, bytes: s.size, mtimeMs: s.mtimeMs };
  writeFileSync(`${stampFile(file)}.writing`, `${JSON.stringify(stamp)}\n`);
  renameSync(`${stampFile(file)}.writing`, stampFile(file));
}

/** A file's SHA-256, read a megabyte at a time. */
async function sha256Of(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024, signal }))
    hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export type LanguageModelCheck = 'ready' | 'missing' | 'changed';

/**
 * The quick check before each use: the file is the entry's size, and its size and time are as when its SHA-256 was
 * checked. Anything else is a changed file (never used until checked whole again).
 */
export function checkLanguageModel(file: string, entry: LanguageModelEntry): LanguageModelCheck {
  let size: number;
  let mtimeMs: number;
  try {
    const s = statSync(file);
    size = s.size;
    mtimeMs = s.mtimeMs;
  } catch {
    return 'missing';
  }
  const stamp = readStamp(file);
  return stamp !== null &&
    stamp.sha256 === entry.sha256 &&
    stamp.bytes === entry.bytes &&
    size === entry.bytes &&
    stamp.mtimeMs === mtimeMs
    ? 'ready'
    : 'changed';
}

/** Check the file whole again: still the entry's file, it is stamped again and ready; otherwise changed. */
export async function verifyLanguageModel(
  file: string,
  entry: LanguageModelEntry,
  signal?: AbortSignal,
): Promise<LanguageModelCheck> {
  try {
    if (statSync(file).size !== entry.bytes) return 'changed';
  } catch {
    return 'missing';
  }
  const sha = await sha256Of(file, signal).catch(() => null);
  if (sha === null) return 'missing';
  if (sha !== entry.sha256) return 'changed';
  writeStamp(file, sha);
  return 'ready';
}

// Leave the same room as recordings, imports, backups and the general model's download.
const KEEP_FREE_BYTES = 2 * 1024 ** 3;

/**
 * A file an admin chose for `language`: checked whole and refused unless it is a model Drashti knows for that
 * language; then copied into the data folder, the copy checked whole again, and stamped. Returns its entry.
 */
export async function addLanguageModelFile(o: {
  userData: string;
  source: string;
  language: LanguageModelLanguage;
  known: readonly LanguageModelEntry[];
  freeBytes?: (folder: string) => Promise<number | null>;
  signal?: AbortSignal;
}): Promise<LanguageModelEntry> {
  const name = languageName(o.language);
  const unknown = new LanguageModelRefused(
    `This file is not a model Drashti knows for ${name}, so it was not added. Use a file from the approved list of captions models.`,
  );
  let size: number;
  try {
    size = statSync(o.source).size;
  } catch (error) {
    throw new LanguageModelRefused(`Drashti could not read that file. ${fileProblem(error, 'read')}`);
  }
  // Only a file of a known size can be one of them: anything else is refused without reading it.
  if (!o.known.some((k) => k.bytes === size)) throw unknown;
  let sha: string;
  try {
    sha = await sha256Of(o.source, o.signal);
  } catch (error) {
    if (o.signal?.aborted) throw new LanguageModelRefused('Adding the model was stopped.');
    throw new LanguageModelRefused(`Drashti could not read that file. ${fileProblem(error, 'read')}`);
  }
  const entry = o.known.find((k) => k.sha256 === sha && k.bytes === size);
  if (!entry) throw unknown;
  if (entry.language !== o.language)
    throw new LanguageModelRefused(
      `This file is the ${languageName(entry.language)} model, not a ${name} one, so it was not added.`,
    );
  const dest = languageModelFile(o.userData, entry.id);
  const part = `${dest}.part`;
  const folder = join(o.userData, 'speech-models', 'languages');
  try {
    mkdirSync(folder, { recursive: true });
    const free = await (o.freeBytes ?? freeBytesOf)(folder);
    if (free === null)
      throw new LanguageModelRefused(
        'Drashti could not check the free space for the model: check the drive, then add it again.',
      );
    const short = KEEP_FREE_BYTES + entry.bytes - free;
    if (short > 0)
      throw new LanguageModelRefused(
        `Free at least ${String(Math.ceil(short / 1_000_000))} MB more on this computer, then add the model again.`,
      );
    o.signal?.throwIfAborted();
    // Off the main thread (a model is hundreds of megabytes), then the copy itself checked whole.
    await copyFile(o.source, part);
    const copied = await sha256Of(part, o.signal);
    if (copied !== entry.sha256 || statSync(part).size !== entry.bytes)
      throw new LanguageModelRefused(
        'The copy of the model did not match its check, so it was thrown away. Try adding it again.',
      );
    rmSync(stampFile(dest), { force: true });
    renameSync(part, dest);
    writeStamp(dest, copied);
    return entry;
  } catch (error) {
    rmSync(part, { force: true });
    if (error instanceof LanguageModelRefused) throw error;
    if (o.signal?.aborted) throw new LanguageModelRefused('Adding the model was stopped.');
    throw new LanguageModelRefused(`Drashti could not save the model. ${fileProblem(error, 'own')}`);
  }
}

/**
 * The models this copy knows: the list above; for tests only (never a packaged Drashti) the test switch
 * DRASHTI_TEST_SPEECH_MODELS names a file listing placeholder models instead.
 */
export function knownLanguageModels(testList: string | undefined): readonly LanguageModelEntry[] {
  if (testList === undefined) return LANGUAGE_MODELS;
  try {
    return parseLanguageModelList(JSON.parse(readFileSync(testList, 'utf8')));
  } catch {
    return [];
  }
}

/** The language models in this computer's data folder, as the captions service asks for them. */
export function languageModelStore(userData: string, known: readonly LanguageModelEntry[]) {
  return {
    known: () => known,
    check: (entry: LanguageModelEntry) => checkLanguageModel(languageModelFile(userData, entry.id), entry),
    verify: (entry: LanguageModelEntry) => verifyLanguageModel(languageModelFile(userData, entry.id), entry),
    add: (language: LanguageModelLanguage, source: string) =>
      addLanguageModelFile({ userData, source, language, known }),
  };
}
