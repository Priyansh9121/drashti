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
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { CaptionModelId } from '../../shared/captions';
import { fileProblem } from '../plain-errors';
import { freeBytesOf } from '../stream/recording-drive';

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
async function sha256Of(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024, signal }))
    hash.update(chunk as Buffer);
  return hash.digest('hex');
}

const OFFLINE =
  'No internet: the captions model downloads once, when this computer is online. Try again when it is.';
const TOO_LARGE = 'The captions model was larger than expected. The unfinished download was thrown away.';
// Leave the same room as recordings, imports and backups.
const KEEP_FREE_BYTES = 2 * 1024 ** 3;

/** Download the model to `dest`, carrying on from a ".part" already there; checked before it is kept. */
export async function downloadModel(o: {
  dest: string;
  source: ModelSource;
  progress: (done: number, total: number) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  freeBytes?: (folder: string) => Promise<number | null>;
}): Promise<void> {
  const get = o.fetch ?? fetch;
  const freeBytes = o.freeBytes ?? freeBytesOf;
  const folder = dirname(o.dest);
  const part = `${o.dest}.part`;
  const total = o.source.bytes;
  const checkRoom = async (have: number) => {
    const free = await freeBytes(folder);
    if (free === null)
      throw new ModelDownloadError('Drashti could not check the free space for the captions model.');
    const short = KEEP_FREE_BYTES + total - have - free;
    if (short > 0)
      throw new ModelDownloadError(
        `Free at least ${String(Math.ceil(short / 1_000_000))} MB more on this computer, then try the captions model again.`,
      );
    o.signal?.throwIfAborted();
  };
  const transfer = async (have: number): Promise<void> => {
    let response: Response;
    try {
      response = await get(o.source.url, {
        headers: have > 0 ? { Range: `bytes=${String(have)}-` } : {},
        signal: o.signal,
      });
    } catch {
      throw new ModelDownloadError(OFFLINE);
    }
    const body = response.body;
    try {
      o.signal?.throwIfAborted();
      if (response.status === 200 && have > 0) {
        // The server sends it all again. Recheck the disk, then reclaim the partial file by truncating it.
        await checkRoom(have);
        have = 0;
      } else if (response.status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(response.headers.get('Content-Range') ?? '');
        if (
          !range ||
          Number(range[1]) !== have ||
          Number(range[2]) < have ||
          Number(range[2]) >= total ||
          Number(range[3]) !== total
        )
          throw new ModelDownloadError('The server sent the wrong part of the captions model. Try again.');
      } else if (response.status !== 200) {
        throw new ModelDownloadError(
          `The captions model could not be downloaded (the server said ${String(response.status)}).`,
        );
      }
      if (!body) throw new ModelDownloadError('The captions model could not be downloaded (no data came).');
      if (Number(response.headers.get('Content-Length')) > total - have)
        throw new ModelDownloadError(TOO_LARGE);

      let done = have;
      o.progress(done, total);
      const input = Readable.fromWeb(body);
      const out = createWriteStream(part, { flags: have > 0 ? 'a' : 'w' });
      let failure: 'read' | 'write' | undefined;
      // pipeline closes both streams on failure; whichever reported it first tells us why.
      input.once('error', () => {
        failure ??= 'read';
      });
      out.once('error', () => {
        failure ??= 'write';
      });
      try {
        await pipeline(
          input,
          async function* (chunks) {
            for await (const chunk of chunks as AsyncIterable<Uint8Array>) {
              if (chunk.byteLength > total - done) throw new ModelDownloadError(TOO_LARGE);
              done += chunk.byteLength;
              yield chunk;
              o.progress(done, total);
            }
          },
          out,
          { signal: o.signal },
        );
      } catch (error) {
        if (!(error instanceof ModelDownloadError) && failure === 'read')
          throw new ModelDownloadError(OFFLINE);
        throw error;
      } finally {
        // On a failure pipeline settles without waiting for the part file to close, and the file may not even be
        // open yet: Node opens it on its file pool, late on a busy computer. Wait for it, so that a part file thrown
        // away stays away, and one carried on from holds all it will hold.
        if (!out.closed)
          await new Promise<void>((resolve) => {
            out.once('close', resolve);
          });
      }
      if (done !== total) throw new ModelDownloadError(OFFLINE);
    } finally {
      if (body && !body.locked) await body.cancel().catch(() => undefined);
    }
  };

  try {
    o.signal?.throwIfAborted();
    mkdirSync(folder, { recursive: true });
    let have = existsSync(part) ? statSync(part).size : 0;
    if (have > total) {
      rmSync(part, { force: true });
      have = 0;
    }
    await checkRoom(have);
    if (have < total) await transfer(have);
    // Checked whole (a carried-on download included) before it is kept.
    const sha = await sha256Of(part, o.signal);
    o.signal?.throwIfAborted();
    if (sha !== o.source.sha256) {
      rmSync(part, { force: true });
      throw new ModelDownloadError(
        'The captions model did not match its check, so it was thrown away. Try again; if it happens again, tell whoever looks after Drashti.',
      );
    }
    renameSync(part, o.dest);
    writeFileSync(`${o.dest}.sha256`, `${sha}\n`);
  } catch (error) {
    if (o.signal?.aborted) throw new ModelDownloadError('The download was stopped.');
    if (error instanceof ModelDownloadError) {
      if (error.message === TOO_LARGE) rmSync(part, { force: true });
      throw error;
    }
    throw new ModelDownloadError(`Drashti could not save the captions model. ${fileProblem(error, 'own')}`);
  }
}
