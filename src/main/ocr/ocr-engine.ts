import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { TesseractAnswer } from 'tesseract.js/src/worker-script/index.js';
import { dispatchHandlers, setAdapter } from 'tesseract.js/src/worker-script/index.js';

/*
 * Reading a page's words (book OCR, alpha.21; the owner's Q60-58, "A, Tesseract inside"): Tesseract's own
 * WebAssembly build (tesseract.js-core) with Tesseract's best Gujarati script model, run by tesseract.js's own worker
 * code in this process, which is the reading process (ocr-worker.ts), never Main. Everything it needs is in Drashti:
 * the core's loader and its WebAssembly, and the model. Nothing is ever fetched: the core is handed its WebAssembly's
 * bytes, the model is read from its file, and any other address tesseract.js could ask for is refused. Nothing is
 * written anywhere either (no cache).
 */

/** The model's name, as its file is called (`Gujarati.traineddata`): tessdata_best's Gujarati script model. */
export const OCR_MODEL = 'Gujarati';

/** The files a reading needs. */
export interface OcrFiles {
  /** The core's loader, `tesseract-core-simd-lstm.js`. */
  core: string;
  /** Its WebAssembly, `tesseract-core-simd-lstm.wasm`. */
  wasm: string;
  /** The model, `Gujarati.traineddata`. */
  model: string;
}

export const NO_NETWORK = 'Drashti reads words without the internet: nothing is fetched.';

/** Tesseract's page layout: find the page's blocks and lines itself, as Tesseract's own program does. */
const PSM_AUTO = '3';
/** Tesseract's LSTM engine only: the model is an LSTM model. */
const OEM_LSTM_ONLY = 1;

export interface OcrReader {
  /** A picture's words (PNG, JPEG, TIFF, WebP, GIF or BMP), as Tesseract reads them; `progress` from 0 to 1. */
  read(image: Uint8Array, progress?: (fraction: number) => void): Promise<string>;
}

const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

type CoreFactory = (options: Record<string, unknown>) => Promise<unknown>;

let opened: Promise<OcrReader> | null = null;

/**
 * The reader, made once for this process (tesseract.js's worker code holds one engine): the core started, the
 * model loaded. `starting` hears its progress from 0 to 1.
 */
export function openReader(files: OcrFiles, starting?: (fraction: number) => void): Promise<OcrReader> {
  opened ??= makeReader(files, starting);
  return opened;
}

async function makeReader(files: OcrFiles, starting?: (fraction: number) => void): Promise<OcrReader> {
  if (basename(files.model) !== `${OCR_MODEL}.traineddata`)
    throw new Error(`The model must be ${OCR_MODEL}.traineddata.`);
  const model = resolve(files.model);
  const isModel = (path: unknown) => typeof path === 'string' && resolve(path) === model;
  setAdapter({
    getCore: async () => {
      const wasmBinary = await readFile(files.wasm);
      // The core's loader as it is, read at run time from its own file (never bundled, never fetched).
      const Core = createRequire(resolve(files.core))(resolve(files.core)) as CoreFactory;
      // Quiet: Tesseract's own notes (as "Estimating resolution as …") are not printed.
      return (options: Record<string, unknown>) =>
        Core({ ...options, wasmBinary, print: () => undefined, printErr: () => undefined });
    },
    gunzip: gunzipSync,
    // tesseract.js asks for the model by its folder and name; that one file is read, nothing else is ever fetched.
    fetch: async (url: unknown) => {
      if (!isModel(url)) throw new Error(NO_NETWORK);
      const bytes = await readFile(model);
      return { ok: true, status: 200, arrayBuffer: () => Promise.resolve(asArrayBuffer(bytes)) };
    },
    readCache: async (path: unknown) => (isModel(path) ? readFile(model) : undefined),
    writeCache: () => Promise.resolve(),
    deleteCache: () => Promise.resolve(),
    checkCache: () => Promise.resolve(false),
  });

  let next = 0;
  let listening: ((status: string, fraction: number) => void) | null = null;
  const pending = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void }>();
  const send = (answer: TesseractAnswer) => {
    if (answer.status === 'progress') {
      const { status, progress } = (answer.data ?? {}) as { status?: unknown; progress?: unknown };
      if (typeof status === 'string' && typeof progress === 'number') listening?.(status, progress);
      return;
    }
    const waiting = pending.get(answer.jobId);
    if (!waiting) return;
    pending.delete(answer.jobId);
    if (answer.status === 'resolve') waiting.resolve(answer.data);
    else
      waiting.reject(
        new Error(typeof answer.data === 'string' ? answer.data : 'The words could not be read.'),
      );
  };
  const ask = (action: string, payload: unknown): Promise<unknown> =>
    new Promise((resolveJob, rejectJob) => {
      const jobId = `Job-${String(next++)}`;
      pending.set(jobId, { resolve: resolveJob, reject: rejectJob });
      dispatchHandlers({ jobId, workerId: 'Drashti', action, payload }, send);
    });

  // Starting: the core (about half), the model, then the engine with it.
  listening = (status, fraction) => {
    const at =
      status === 'loading language traineddata'
        ? 0.5 + fraction * 0.3
        : status === 'initializing api'
          ? 0.8 + fraction * 0.2
          : fraction * 0.5;
    starting?.(Math.min(1, Math.max(0, at)));
  };
  await ask('load', { options: { lstmOnly: true, logging: false } });
  await ask('loadLanguage', {
    langs: OCR_MODEL,
    options: { langPath: dirname(model), cacheMethod: 'none', gzip: false, lstmOnly: true },
  });
  await ask('initialize', { langs: OCR_MODEL, oem: OEM_LSTM_ONLY, config: {} });
  await ask('setParameters', { params: { tessedit_pageseg_mode: PSM_AUTO } });
  listening = null;
  starting?.(1);

  let turn: Promise<unknown> = Promise.resolve();
  return {
    read(image, progress) {
      const run = turn.then(async () => {
        listening = (status, fraction) => {
          if (status === 'recognizing text') progress?.(Math.min(1, Math.max(0, fraction)));
        };
        try {
          const result = (await ask('recognize', { image, options: {}, output: { text: true } })) as {
            text?: unknown;
          };
          return typeof result.text === 'string' ? result.text : '';
        } finally {
          listening = null;
        }
      });
      turn = run.catch(() => undefined);
      return run;
    },
  };
}

/**
 * The words as New from words takes them: each line without spaces at its ends, at most one blank line between
 * blocks (a blank line starts a new slide there), none at the start or the end.
 */
export function tidyRead(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/\f/gu, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}
