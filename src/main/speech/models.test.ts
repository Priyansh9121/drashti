import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
    res.writeHead(range ? 206 : 200, { 'Content-Length': String(part.length) });
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
