import { createHash, pbkdf2 } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPTION_MODELS, defaultModel } from '../../shared/captions';
import { downloadModel, MODEL_SOURCES, modelFile, modelReady, type ModelSource } from './models';

/*
 * The captions model (Part 10): downloaded once, into Drashti's data folder, from its free public source, pinned by
 * SHA-256. Here the "source" is a server on 127.0.0.1 serving made-up bytes: a test never downloads anything.
 */

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

/** Serve `body` at /model.bin, honouring a Range request; `cut` sends only that many bytes, then hangs up. */
async function serve(body: Buffer, cut?: number): Promise<string> {
  server = createServer((req, res) => {
    const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    const from = range ? Number(range[1]) : 0;
    const part = body.subarray(from);
    res.writeHead(range ? 206 : 200, {
      'Content-Length': String(part.length),
      ...(range ? { 'Content-Range': `bytes ${from}-${body.length - 1}/${body.length}` } : {}),
    });
    if (cut !== undefined && from === 0) {
      // The first bytes reach the other end, then the line drops.
      res.write(part.subarray(0, cut), () => setTimeout(() => res.destroy(), 50));
      return;
    }
    res.end(part);
  });
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${String(address.port)}/model.bin`;
}

function source(url: string, body: Buffer): ModelSource {
  return { url, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), licence: 'MIT' };
}

/**
 * Keep every thread of Node's file pool (libuv's: 4 unless UV_THREADPOOL_SIZE says otherwise) busy for a moment, as a
 * busy computer does now and then: a file opened meanwhile opens only once the pool is free again.
 */
function keepFilePoolBusy(): Promise<unknown> {
  const threads = Number(process.env['UV_THREADPOOL_SIZE']) || 4;
  return Promise.all(
    Array.from(
      { length: threads },
      () => new Promise((done) => pbkdf2('busy', 'pool', 500_000, 32, 'sha256', done)),
    ),
  );
}

describe('the captions model (Part 10)', () => {
  it('pins each model to a fixed revision and its SHA-256, MIT, from the whisper.cpp models', () => {
    for (const id of Object.keys(CAPTION_MODELS) as (keyof typeof CAPTION_MODELS)[]) {
      const s = MODEL_SOURCES[id];
      expect(s.url).toMatch(
        /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/[0-9a-f]{40}\/ggml-/,
      );
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.bytes).toBe(CAPTION_MODELS[id].bytes);
      expect(s.licence).toBe('MIT');
    }
    expect(defaultModel('darwin', 'arm64')).toBe('turbo');
    expect(defaultModel('win32', 'x64')).toBe('small');
    expect(defaultModel('darwin', 'x64')).toBe('small');
  });

  it('downloads once into the data folder, with progress, checked before it is kept', async () => {
    const data = mkdtempSync(join(tmpdir(), 'drashti-captions-model-'));
    const body = Buffer.alloc(300_000, 7);
    const url = await serve(body);
    const seen: number[] = [];
    await downloadModel({
      dest: modelFile(data, 'small'),
      source: source(url, body),
      progress: (done) => seen.push(done),
    });
    expect(readFileSync(modelFile(data, 'small'))).toEqual(body);
    expect(modelFile(data, 'small').startsWith(join(data, 'speech-models'))).toBe(true);
    expect(seen.at(-1)).toBe(body.length);
    expect(modelReady(modelFile(data, 'small'), source(url, body))).toBe(true);
    expect(existsSync(`${modelFile(data, 'small')}.part`)).toBe(false);
  });

  it('carries on from where a cut-off download stopped', async () => {
    const data = mkdtempSync(join(tmpdir(), 'drashti-captions-model-'));
    const body = Buffer.from(Array.from({ length: 200_000 }, (_, i) => i % 251));
    const url = await serve(body, 50_000);
    const dest = modelFile(data, 'small');
    await expect(
      downloadModel({ dest, source: source(url, body), progress: () => undefined }),
    ).rejects.toThrow();
    expect(existsSync(`${dest}.part`)).toBe(true);
    server?.close();
    const again = await serve(body);
    await downloadModel({ dest, source: source(again, body), progress: () => undefined });
    expect(readFileSync(dest)).toEqual(body);
  });

  it('throws away a file that fails its check, and says so plainly', async () => {
    const data = mkdtempSync(join(tmpdir(), 'drashti-captions-model-'));
    const body = Buffer.alloc(10_000, 1);
    const url = await serve(body);
    const dest = modelFile(data, 'small');
    const wrong = { ...source(url, body), sha256: '0'.repeat(64) };
    await expect(downloadModel({ dest, source: wrong, progress: () => undefined })).rejects.toThrow(
      /did not match its check/,
    );
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it('checks the space for the remaining bytes before reaching the network', async () => {
    const data = mkdtempSync(join(tmpdir(), 'drashti-captions-model-'));
    const dest = modelFile(data, 'small');
    const body = Buffer.alloc(32, 1);
    const part = body.subarray(0, 12);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(`${dest}.part`, part);
    const fetch = vi.fn(() => Promise.resolve(new Response(new Uint8Array(body))));
    await expect(
      downloadModel({
        dest,
        source: source('https://example.invalid/model.bin', body),
        progress: () => undefined,
        freeBytes: () => Promise.resolve(2 * 1024 ** 3 + body.length - part.length - 1),
        fetch,
      }),
    ).rejects.toThrow(/Free .* on this computer/);
    expect(fetch).not.toHaveBeenCalled();
    expect(readFileSync(`${dest}.part`)).toEqual(part);
  });

  it('stops a response that exceeds the pinned size even without a Content-Length', async () => {
    const data = mkdtempSync(join(tmpdir(), 'drashti-captions-model-'));
    const dest = modelFile(data, 'small');
    const body = Buffer.alloc(16, 1);
    const wrong = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(12));
        controller.enqueue(new Uint8Array(12));
        controller.close();
      },
    });
    const seen: number[] = [];
    await expect(
      downloadModel({
        dest,
        source: source('https://example.invalid/model.bin', body),
        progress: (done) => seen.push(done),
        fetch: () => Promise.resolve(new Response(wrong)),
      }),
    ).rejects.toThrow(/larger than expected/);
    expect(seen.every((done) => done <= body.length)).toBe(true);
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(existsSync(dest)).toBe(false);
  });

  it('throws a too-large download away even when its file opens late, on a busy computer', async () => {
    const data = mkdtempSync(join(tmpdir(), 'drashti-captions-model-'));
    const dest = modelFile(data, 'small');
    const body = Buffer.alloc(16, 1);
    const wrong = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(12));
        controller.enqueue(new Uint8Array(12));
        controller.close();
      },
    });
    // The part file opens on Node's file pool. With the pool busy (CI's runners, now and then) it opens only after
    // the bytes were found too many: a part file removed before that would appear afterwards, left behind.
    const busy = keepFilePoolBusy();
    await expect(
      downloadModel({
        dest,
        source: source('https://example.invalid/model.bin', body),
        progress: () => undefined,
        // Not the real free-space check: it would wait for the busy pool too.
        freeBytes: () => Promise.resolve(Number.MAX_SAFE_INTEGER),
        fetch: () => Promise.resolve(new Response(wrong)),
      }),
    ).rejects.toThrow(/larger than expected/);
    // Once the pool is free again (and has made one more trip), the open that waited for it has run.
    await busy;
    await stat(data);
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(existsSync(dest)).toBe(false);
  });

  it('cancels a stalled response, without discarding the bytes already saved', async () => {
    const data = mkdtempSync(join(tmpdir(), 'drashti-captions-model-'));
    const dest = modelFile(data, 'small');
    const body = Buffer.alloc(16, 1);
    const abort = new AbortController();
    const cancelled = vi.fn();
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(`${dest}.part`, body.subarray(0, 8));
    const stalled = new ReadableStream<Uint8Array>(
      {
        pull: () => {
          setImmediate(() => abort.abort());
        },
        cancel: cancelled,
      },
      { highWaterMark: 0 },
    );
    await expect(
      downloadModel({
        dest,
        source: source('https://example.invalid/model.bin', body),
        progress: () => undefined,
        signal: abort.signal,
        fetch: () =>
          Promise.resolve(
            new Response(stalled, { status: 206, headers: { 'Content-Range': 'bytes 8-15/16' } }),
          ),
      }),
    ).rejects.toThrow(/download was stopped/);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(readFileSync(`${dest}.part`)).toEqual(body.subarray(0, 8));
    expect(existsSync(dest)).toBe(false);
  });

  it('reports a write-stream failure without leaving the request running', async () => {
    const data = mkdtempSync(join(tmpdir(), 'drashti-captions-model-'));
    const dest = modelFile(data, 'small');
    const body = Buffer.alloc(16, 1);
    const cancelled = vi.fn();
    const stalled = new ReadableStream<Uint8Array>({ cancel: cancelled });
    await expect(
      downloadModel({
        dest,
        source: source('https://example.invalid/model.bin', body),
        progress: () => undefined,
        fetch: () => {
          // The file became unavailable after the preflight, before opening the write stream.
          mkdirSync(`${dest}.part`);
          return Promise.resolve(new Response(stalled));
        },
      }),
    ).rejects.toThrow(/could not save the captions model/);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(existsSync(dest)).toBe(false);
  });

  it('says plainly when there is no internet', async () => {
    const data = mkdtempSync(join(tmpdir(), 'drashti-captions-model-'));
    const body = Buffer.alloc(10, 1);
    // Nothing listens on this port.
    const url = await serve(body);
    server?.close();
    await new Promise((done) => setTimeout(done, 50));
    await expect(
      downloadModel({ dest: modelFile(data, 'small'), source: source(url, body), progress: () => undefined }),
    ).rejects.toThrow(/No internet: the captions model downloads once, when this computer is online/);
  });

  it('is ready only when its file is whole (its size; its check was made as it came)', () => {
    const data = mkdtempSync(join(tmpdir(), 'drashti-captions-model-'));
    const body = Buffer.alloc(100, 2);
    const s = source('https://example.invalid/model.bin', body);
    const dest = modelFile(data, 'small');
    expect(modelReady(dest, s)).toBe(false);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body.subarray(0, 50));
    expect(modelReady(dest, s)).toBe(false);
  });
});
