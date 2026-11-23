import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { buildIndic } from './build-indic.mjs';
import { makeIndicFixture } from './indic-fixture.mjs';

test('native helper decodes generated PCM with real ORT and CTC blank/repeat rules', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drashti-indic-'));
  try {
    const fixture = makeIndicFixture();
    for (const [name, data] of [
      ['model.onnx', fixture.model],
      ['tokens.txt', fixture.tokens],
      ['frontend.bin', fixture.frontend],
    ])
      writeFileSync(join(root, name), data);
    const program = buildIndic({ ort: process.env.DRASHTI_ORT_ROOT, output: join(root, 'bin') });
    const p = spawn(
      program,
      [
        '--lang',
        'gu',
        join(root, 'model.onnx'),
        join(root, 'tokens.txt'),
        '--frontend',
        join(root, 'frontend.bin'),
        '--threads',
        '1',
        '--pcm-serve',
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH:
            join(process.env.DRASHTI_ORT_ROOT, 'runtimes', 'win-x64', 'native') +
            delimiter +
            process.env.PATH,
        },
      },
    );
    let output = '',
      errors = '';
    p.stdout.on('data', (data) => {
      output += data.toString();
    });
    p.stderr.on('data', (data) => {
      errors += data.toString();
    });
    const done = new Promise((resolve, reject) => {
      p.once('error', reject);
      p.once('close', resolve);
    });
    const pcm = Buffer.alloc(3200);
    for (let i = 0; i < 1600; i += 1) pcm.writeInt16LE(Math.round(5000 * Math.sin(i * 0.2)), i * 2);
    const header = Buffer.alloc(4);
    header.writeUInt32LE(pcm.length);
    p.stdin.end(Buffer.concat([header, pcm]));
    assert.equal(await done, 0, errors);
    const lines = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(lines[0], {
      ready: true,
      protocolVersion: 1,
      sampleRate: 16000,
      channels: 1,
      sampleFormat: 's16le',
    });
    assert.equal(lines.length, 2);
    assert.equal(lines[1].text, 'shape shape box');
    assert.equal(lines[1].confidence, null);
    assert.equal(lines[1].language, 'gu');
    assert.deepEqual(
      lines[1].words.map((w) => w.w),
      ['shape', 'shape', 'box'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
