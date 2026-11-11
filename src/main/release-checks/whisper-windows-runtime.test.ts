import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { windowsWhisperRuntime } from '../../../scripts/fetch-whisper.mjs';
import libraries from '../../shared/whisper-windows-runtime.json';

describe('Windows captions runtime staging', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'whisper-redist-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function runtime(version: string, architecture = 'x64', omit?: string): void {
    for (const [name, component] of Object.entries(libraries)) {
      if (name === omit) continue;
      const file = join(root, version, architecture, `Microsoft.VC145.${component}`, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, 'placeholder');
    }
  }

  it('selects one complete x64 redistribution from the newest supported version', () => {
    runtime('14.51.100');
    runtime('14.52.200');
    runtime('14.53.300', 'x64', 'vcomp140.dll');
    const selected = windowsWhisperRuntime(root);
    expect(selected?.version).toBe('14.52.200');
    expect(selected?.files.map(({ name }) => name).sort()).toEqual(Object.keys(libraries).sort());
    expect(selected?.files.every(({ path }) => path.startsWith(join(root, '14.52.200', 'x64')))).toBe(true);
  });

  it('refuses older runtimes and the other architecture', () => {
    runtime('14.44.100');
    runtime('14.52.200', 'x86');
    expect(windowsWhisperRuntime(root)).toBeNull();
  });

  it('refuses an incomplete runtime and ignores debug distributions', () => {
    runtime('14.52.200', 'x64', 'vcomp140.dll');
    runtime('debug_nonredist');
    expect(windowsWhisperRuntime(root)).toBeNull();
    expect(windowsWhisperRuntime(join(root, 'missing'))).toBeNull();
  });
});
