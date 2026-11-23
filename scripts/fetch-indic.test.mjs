import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ORT_RELEASE, ORT_TARGETS, verifyOrtArchive } from './fetch-indic.mjs';

test('only the approved three targets and pinned Microsoft release are selected', () => {
  assert.equal(ORT_RELEASE.version, '1.23.2');
  assert.equal(ORT_RELEASE.bytes, 123371574);
  assert.equal(ORT_RELEASE.sha256, '25fe172f7fcdf34f2b5b02c8b997f6b88abc282956849d4af4335af23d0c4e4a');
  assert.ok(
    ORT_RELEASE.url.startsWith('https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/1.23.2/'),
  );
  assert.deepEqual(Object.keys(ORT_TARGETS).sort(), ['darwin-arm64', 'darwin-x64', 'win32-x64']);
  assert.deepEqual(ORT_TARGETS['win32-x64'].files, ['onnxruntime.dll', 'onnxruntime_providers_shared.dll']);
});
test('wrong-sized and wrong-hash archives are rejected before extraction', () => {
  const root = mkdtempSync(join(tmpdir(), 'drashti-ort-hash-'));
  try {
    const file = join(root, 'fake.zip');
    writeFileSync(file, 'fake');
    assert.throws(() => verifyOrtArchive(file), /size/);
    assert.throws(() => verifyOrtArchive(file, { bytes: 4, sha256: '0'.repeat(64) }), /SHA-256/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
