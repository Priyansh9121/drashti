import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeReply, fetchModel, modelPin, runtimeLoaded } from '../../../scripts/whisper-decode-check.mjs';
import windowsRuntime from '../../shared/whisper-windows-runtime.json';
import { MODEL_SOURCES } from '../speech/models';

/*
 * The captions engine decodes on a Windows without Visual C++ (Session 58, X2b): the Release run's installed check
 * (scripts/check-installers.mjs) starts the installed whisper-server.exe with Drashti's smallest model, has it decode a
 * clip its own FFmpeg makes, and lists the process's modules. Here: the model it takes, how it reads the engine's
 * answer, and how it tells the app-local libraries from the system's.
 */

const ENGINE = 'C:\\Users\\runneradmin\\AppData\\Local\\Programs\\Drashti\\resources\\whisper';
const LIBRARIES = Object.keys(windowsRuntime);
const SYSTEM = 'C:\\Windows\\SYSTEM32';
const others = [
  'C:\\Windows\\SYSTEM32\\ntdll.dll',
  'C:\\Windows\\System32\\KERNEL32.DLL',
  `${ENGINE}\\whisper-server.exe`,
  `${ENGINE}\\whisper.dll`,
  `${ENGINE}\\ggml.dll`,
];

describe('the captions engine decodes on a clean Windows (Session 58, X2b)', () => {
  it('decodes with the smallest model Drashti offers, as models.ts pins it', () => {
    const pin = modelPin(readFileSync(join(__dirname, '..', 'speech', 'models.ts'), 'utf8'));
    expect(pin).toEqual({
      file: 'ggml-small.bin',
      url: MODEL_SOURCES.small.url,
      bytes: MODEL_SOURCES.small.bytes,
      sha256: MODEL_SOURCES.small.sha256,
    });
    expect(() => modelPin('export const MODEL_SOURCES = {};')).toThrow('the small model’s pin was not found');
  });

  it('passes only when every Visual C++ library the engine loaded is the one beside it', () => {
    expect(LIBRARIES).toEqual(['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll']);
    const local = [...others, ...LIBRARIES.map((dll) => `${ENGINE}\\${dll.toUpperCase()}`)];
    expect(runtimeLoaded(local, ENGINE, LIBRARIES)).toEqual({
      ok: true,
      line: 'the captions engine loaded its Visual C++ libraries from its own folder (msvcp140.dll, vcruntime140.dll, vcruntime140_1.dll, vcomp140.dll)',
    });
    // The system's copy (as on a PC with Visual C++ installed, if the app-local one were not found): never a pass.
    const fromSystem = local.map((m) =>
      m.toLowerCase().endsWith('msvcp140.dll') ? `${SYSTEM}\\msvcp140.dll` : m,
    );
    expect(runtimeLoaded(fromSystem, ENGINE, LIBRARIES)).toEqual({
      ok: false,
      line: 'the captions engine loaded Visual C++ libraries from outside its folder: msvcp140.dll from C:\\Windows\\SYSTEM32\\msvcp140.dll',
    });
    // A module list without the C runtime was not read right.
    expect(runtimeLoaded(others, ENGINE, LIBRARIES).ok).toBe(false);
    expect(runtimeLoaded([], ENGINE, LIBRARIES).line).toContain('vcruntime140.dll is not among its modules');
  });

  it('reads a decode as passed only when the engine answered with JSON holding a text', () => {
    expect(decodeReply(200, '{"text":" [MUSIC]\\n"}')).toEqual({
      ok: true,
      line: 'the captions engine decoded a generated clip (it read "[MUSIC]")',
    });
    expect(decodeReply(200, '{"text":""}').ok).toBe(true);
    expect(decodeReply(500, '{"error":"failed to read audio"}')).toEqual({
      ok: false,
      line: 'the captions engine did not decode a generated clip (HTTP 500: {"error":"failed to read audio"})',
    });
    expect(decodeReply(200, 'not json').ok).toBe(false);
    expect(decodeReply(200, '{"error":"no text"}').ok).toBe(false);
  });

  it('downloads the model in three tries with pauses, and keeps it only when it is the one pinned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-model-test-'));
    try {
      const bytes = Buffer.from('a stand-in for the model, nothing real');
      const pin = {
        file: 'model.bin',
        url: 'https://example.invalid/model.bin',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      const file = join(dir, 'model.bin');
      const paused: number[] = [];
      const pause = (ms: number) => {
        paused.push(ms);
        return Promise.resolve();
      };
      let tries = 0;
      const slow = () => {
        tries += 1;
        return tries < 3 ? Promise.reject(new Error('fetch failed')) : Promise.resolve(new Response(bytes));
      };
      expect(await fetchModel(pin, dir, slow, pause)).toBe(file);
      expect(paused).toEqual([5000, 15000]);
      // Already there and right (as the cache restores it): kept, nothing downloaded.
      const never = () => Promise.reject(new Error('nothing should be downloaded'));
      expect(await fetchModel(pin, dir, never, pause)).toBe(file);
      // Another file under its name is downloaded again; a download that is not the pinned one fails loudly and goes.
      writeFileSync(file, 'not the model');
      const wrong = () => Promise.resolve(new Response('not the model either'));
      await expect(fetchModel(pin, dir, wrong, pause)).rejects.toThrow('not the one pinned');
      expect(existsSync(file)).toBe(false);
      // Three failed tries: said plainly.
      const down = () => Promise.resolve(new Response('', { status: 503 }));
      await expect(fetchModel(pin, dir, down, pause)).rejects.toThrow('could not be downloaded (503)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
