import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { whisperSelfTest } from './whisper-selftest';

// Model a build machine on which the engine can start using a system runtime.
vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      _file: string,
      _args: string[],
      _options: unknown,
      done: (error: Error | null, stdout: string, stderr: string) => void,
    ) => done(null, '--request-path path', ''),
  ),
}));

describe('the packaged captions engine', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'whisper-selftest-'));
    vi.clearAllMocks();
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('fails a Windows package missing a local DLL even if the build machine can start Whisper', async () => {
    const path = join(directory, 'whisper-server.exe');
    for (const file of ['whisper-server.exe', 'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'])
      writeFileSync(join(directory, file), 'placeholder');

    const result = await whisperSelfTest(path, 'win32');
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('vcomp140.dll');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('starts the Windows package with its own complete runtime and checks the private route', async () => {
    const path = join(directory, 'whisper-server.exe');
    for (const file of [
      'whisper-server.exe',
      'msvcp140.dll',
      'vcruntime140.dll',
      'vcruntime140_1.dll',
      'vcomp140.dll',
    ])
      writeFileSync(join(directory, file), 'placeholder');

    expect((await whisperSelfTest(path, 'win32')).passed).toBe(true);
    expect(execFile).toHaveBeenCalledWith(path, ['--help'], expect.anything(), expect.any(Function));
  });
});
