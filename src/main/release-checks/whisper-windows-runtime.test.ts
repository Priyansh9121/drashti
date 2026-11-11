import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import copyWhisperWindowsRuntime from '../../../scripts/copy-whisper-windows-runtime.mjs';
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

  it('keeps the Microsoft DLLs out of the extra-resource signing pass', () => {
    const builder = readFileSync(join(import.meta.dirname, '../../../electron-builder.yml'), 'utf8');
    const windowsWhisper = builder.split('from: vendor/whisper/win32-${arch}')[1]?.split('from:')[0];
    expect(builder).toContain('afterPack: scripts/copy-whisper-windows-runtime.mjs');
    for (const name of Object.keys(libraries)) expect(windowsWhisper).toContain(`!${name}`);
  });

  it('copies the staged DLLs unchanged into the Windows application', async () => {
    const source = join(root, 'vendor', 'whisper', 'win32-x64');
    const appOutDir = join(root, 'release');
    const destination = join(appOutDir, 'resources', 'whisper');
    mkdirSync(source, { recursive: true });
    mkdirSync(destination, { recursive: true });
    for (const name of Object.keys(libraries)) writeFileSync(join(source, name), Buffer.from([0, 127, 255]));
    const context = { electronPlatformName: 'win32', appOutDir, packager: { projectDir: root } };

    await copyWhisperWindowsRuntime(context);
    for (const name of Object.keys(libraries)) {
      expect(readFileSync(join(destination, name))).toEqual(readFileSync(join(source, name)));
    }
    await expect(copyWhisperWindowsRuntime(context)).rejects.toMatchObject({ code: 'EEXIST' });
  });
});
