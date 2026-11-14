import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeReply, modelPin, runtimeLoaded } from '../../../scripts/whisper-decode-check.mjs';
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
});
