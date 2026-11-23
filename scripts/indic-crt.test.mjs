import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import copyRuntime from './copy-whisper-windows-runtime.mjs';
import libraries from '../src/shared/whisper-windows-runtime.json' with { type: 'json' };

test('the existing signed CRT is copied unchanged beside both native engines', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drashti-indic-crt-'));
  try {
    const source = join(root, 'vendor', 'whisper', 'win32-x64');
    const appOutDir = join(root, 'release');
    mkdirSync(source, { recursive: true });
    mkdirSync(join(appOutDir, 'resources', 'whisper'), { recursive: true });
    for (const name of Object.keys(libraries)) writeFileSync(join(source, name), Buffer.from([0, 127, 255]));
    await copyRuntime({ electronPlatformName: 'win32', appOutDir, packager: { projectDir: root } });
    for (const name of Object.keys(libraries)) {
      for (const engine of ['whisper', 'indic'])
        assert.deepEqual(
          readFileSync(join(appOutDir, 'resources', engine, name)),
          Buffer.from([0, 127, 255]),
        );
    }
    await assert.rejects(
      copyRuntime({ electronPlatformName: 'win32', appOutDir, packager: { projectDir: root } }),
      { code: 'EEXIST' },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
