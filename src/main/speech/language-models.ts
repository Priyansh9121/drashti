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
}

/**
 * The language models Drashti knows. None yet: an entry is added here, with its file's exact bytes and SHA-256 and
 * its licence, only once the owner has approved that exact file (x89's list). Until then every language is heard
 * by the general model, as before.
 */
export const LANGUAGE_MODELS: readonly LanguageModelEntry[] = Object.freeze([]);

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
      typeof fallback !== 'boolean'
    )
      continue;
    if (out.some((o) => o.id === id || o.sha256 === sha256)) continue;
    out.push({ id, language, name, bytes, sha256, licence, fallback });
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
      throw new LanguageModelRefused('Drashti could not check the free space for the model.');
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
