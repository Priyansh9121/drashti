import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { CaptionModelId } from '../../shared/captions';

/*
 * The captions model (Session 55, Part 10): whisper.cpp's ggml files (MIT), downloaded once, when an admin turns
 * captions on, from the whisper.cpp project's own models on Hugging Face, pinned to one revision and to each file's
 * SHA-256 (the same as Hugging Face's own LFS check). They go in Drashti's data folder (speech-models/), never in the
 * app or its installers. A download cut off carries on from where it stopped; a file that fails its check is thrown
 * away; no internet says so plainly.
 */

export interface ModelSource {
  url: string;
  bytes: number;
  sha256: string;
  licence: 'MIT';
}

const REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';
const BASE = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${REVISION}`;

export const MODEL_SOURCES: Readonly<Record<CaptionModelId, ModelSource>> = Object.freeze({
  small: {
    url: `${BASE}/ggml-small.bin`,
    bytes: 487_601_967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    licence: 'MIT',
  },
  turbo: {
    url: `${BASE}/ggml-large-v3-turbo-q5_0.bin`,
    bytes: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    licence: 'MIT',
  },
});

/** Where a model is kept on this computer. */
export function modelFile(userData: string, id: CaptionModelId): string {
  return join(userData, 'speech-models', `${id}.bin`);
}

/** Whether the model is here and whole: its size, and the check its download passed (a stamp beside it). */
export function modelReady(file: string, source: ModelSource): boolean {
  try {
    return (
      statSync(file).size === source.bytes && readFileSync(`${file}.sha256`, 'utf8').trim() === source.sha256
    );
  } catch {
    return false;
  }
}

export class ModelDownloadError extends Error {}

/** A file's SHA-256, read a megabyte at a time (a model is half a gigabyte). */
async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024 }))
    hash.update(chunk as Buffer);
  return hash.digest('hex');
}

const OFFLINE =
  'No internet: the captions model downloads once, when this computer is online. Try again when it is.';

/** Download the model to `dest`, carrying on from a ".part" already there; checked before it is kept. */
export async function downloadModel(o: {
  dest: string;
  source: ModelSource;
  progress: (done: number, total: number) => void;
  cancelled?: () => boolean;
  fetch?: typeof fetch;
}): Promise<void> {
  const get = o.fetch ?? fetch;
  const part = `${o.dest}.part`;
  mkdirSync(dirname(o.dest), { recursive: true });
  let have = existsSync(part) ? statSync(part).size : 0;
  if (have >= o.source.bytes) {
    rmSync(part, { force: true });
    have = 0;
  }
  let response: Response;
  try {
    response = await get(o.source.url, { headers: have > 0 ? { Range: `bytes=${String(have)}-` } : {} });
  } catch {
    throw new ModelDownloadError(OFFLINE);
  }
  if (response.status === 200 && have > 0) {
    // The server sends it all again: start over.
    rmSync(part, { force: true });
    have = 0;
  } else if (response.status !== 200 && response.status !== 206) {
    throw new ModelDownloadError(
      `The captions model could not be downloaded (the server said ${String(response.status)}).`,
    );
  }
  if (!response.body)
    throw new ModelDownloadError('The captions model could not be downloaded (no data came).');
  const out = createWriteStream(part, { flags: have > 0 ? 'a' : 'w' });
  let done = have;
  o.progress(done, o.source.bytes);
  try {
    const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      if (o.cancelled?.()) {
        await reader.cancel();
        throw new ModelDownloadError('The download was stopped.');
      }
      done += value.length;
      if (!out.write(value))
        await new Promise<void>((resume) => {
          out.once('drain', () => {
            resume();
          });
        });
      o.progress(done, o.source.bytes);
    }
  } catch (error) {
    if (error instanceof ModelDownloadError) throw error;
    throw new ModelDownloadError(OFFLINE);
  } finally {
    await new Promise<void>((closed) => out.end(closed));
  }
  if (done !== o.source.bytes) throw new ModelDownloadError(OFFLINE);
  // Checked whole (a carried-on download included) before it is kept.
  const sha = await sha256Of(part);
  if (sha !== o.source.sha256) {
    rmSync(part, { force: true });
    throw new ModelDownloadError(
      'The captions model did not match its check, so it was thrown away. Try again; if it happens again, tell whoever looks after Drashti.',
    );
  }
  renameSync(part, o.dest);
  writeFileSync(`${o.dest}.sha256`, `${sha}\n`);
}
