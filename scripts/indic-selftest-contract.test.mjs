import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indicSelfTest } from '../src/main/speech/indic-selftest.ts';

// The packaged app's self-test (check-ffmpeg.mjs --packaged): Route C's helper starts beside its own ONNX Runtime
// (and, on Windows, the app-local Microsoft runtime) without any model, microphone or pack.
const crt = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll'];
const folder = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'indic-selftest-'));
  for (const file of files) writeFileSync(join(dir, file), 'placeholder');
  return dir;
};
const answers = (reply) => {
  const asked = [];
  return {
    asked,
    run: async (path, args) => {
      asked.push([path, args]);
      return reply;
    },
  };
};

test('a missing helper fails without starting anything', async () => {
  const { asked, run } = answers({ ok: true, code: 0, out: '' });
  const result = await indicSelfTest({ path: null, platform: 'darwin', windowsRuntime: crt, run });
  assert.equal(result.passed, false);
  assert.match(result.detail, /missing/u);
  assert.deepEqual(asked, []);
});

test('a Windows package missing an app-local library fails even if this machine could start the helper', async () => {
  const dir = folder(['ic-ctc.exe', 'onnxruntime.dll', 'onnxruntime_providers_shared.dll', 'msvcp140.dll']);
  try {
    const { asked, run } = answers({ ok: true, code: 0, out: '{"runtime":"1.23.2","api":23}\n' });
    const result = await indicSelfTest({ path: join(dir, 'ic-ctc.exe'), platform: 'win32', windowsRuntime: crt, run });
    assert.equal(result.passed, false);
    assert.match(result.detail, /vcruntime140\.dll/u);
    assert.deepEqual(asked, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a Mac package without its ONNX Runtime library fails', async () => {
  const dir = folder(['ic-ctc']);
  try {
    const { asked, run } = answers({ ok: true, code: 0, out: '{"runtime":"1.23.2","api":23}\n' });
    const result = await indicSelfTest({ path: join(dir, 'ic-ctc'), platform: 'darwin', windowsRuntime: crt, run });
    assert.equal(result.passed, false);
    assert.match(result.detail, /libonnxruntime\.dylib/u);
    assert.deepEqual(asked, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a complete Windows package starts the helper alone and needs the approved runtime 1.23.2', async () => {
  const dir = folder(['ic-ctc.exe', 'onnxruntime.dll', 'onnxruntime_providers_shared.dll', ...crt]);
  try {
    const path = join(dir, 'ic-ctc.exe');
    const good = answers({ ok: true, code: 0, out: '{"runtime":"1.23.2","api":23}\r\n' });
    const passed = await indicSelfTest({ path, platform: 'win32', windowsRuntime: crt, run: good.run });
    assert.equal(passed.passed, true, passed.detail);
    assert.deepEqual(good.asked, [[path, ['--runtime']]]);
    const other = answers({ ok: true, code: 0, out: '{"runtime":"1.24.1","api":24}\n' });
    assert.equal((await indicSelfTest({ path, platform: 'win32', windowsRuntime: crt, run: other.run })).passed, false);
    const dll = answers({ ok: false, code: 0xc0000135, out: '' });
    const missing = await indicSelfTest({ path, platform: 'win32', windowsRuntime: crt, run: dll.run });
    assert.equal(missing.passed, false);
    assert.match(missing.detail, /Windows library/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a Mac package that answers with the approved runtime passes; one that fails to start does not', async () => {
  const dir = folder(['ic-ctc', 'libonnxruntime.dylib']);
  try {
    const path = join(dir, 'ic-ctc');
    const good = answers({ ok: true, code: 0, out: '{"runtime":"1.23.2","api":23}\n' });
    assert.equal((await indicSelfTest({ path, platform: 'darwin', windowsRuntime: crt, run: good.run })).passed, true);
    const broken = answers({ ok: false, code: 134, out: '' });
    assert.equal((await indicSelfTest({ path, platform: 'darwin', windowsRuntime: crt, run: broken.run })).passed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
